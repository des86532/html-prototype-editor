import { createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
  API_ROUTES,
  AppError,
  CDN_PRESETS,
  CreateVersionJsonBodySchema,
  UPLOAD_LIMITS,
  UpdateVersionBodySchema,
  type VersionDetailResponse,
  type VersionResponse,
} from '@hpe/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { writeAudit } from '../audit.js';
import { accessOwnedVersion, accessOwnedProject, accessVersion } from '../auth/access.js';
import { actorLabel, authorOf } from '../auth/principal.js';
import type { AppContext } from '../context.js';
import { assets, prototypeVersions } from '../db/schema.js';
import { toProject, toVersion } from '../dto.js';
import { idParam, parseWith } from '../http.js';
import { newContentKey } from '../ids.js';
import { recomputeBlocked } from '../import/analyze.js';
import { detectEntry } from '../import/entryDetect.js';
import { extractZip } from '../import/extractZip.js';
import { gcBlobs, importBundle, singleHtmlBundle } from '../import/pipeline.js';
import { extensionOf, type BundleFile } from '../import/validateEntries.js';

const CDN_ORIGINS: ReadonlySet<string> = new Set(CDN_PRESETS.flatMap((p) => p.origins));
/** JSON 貼上原始碼的 body 上限：原始碼上限加上跳脫膨脹的餘裕 */
const JSON_BODY_LIMIT = UPLOAD_LIMITS.maxSingleHtmlBytes * 2 + 4096;

interface UploadResult {
  files: BundleFile[];
  entryPage?: string | undefined;
}

async function readMultipartUpload(req: FastifyRequest): Promise<UploadResult> {
  let entryPage: string | undefined;
  let files: BundleFile[] | null = null;
  let tmpDir: string | null = null;
  try {
    for await (const part of req.parts()) {
      if (part.type === 'field') {
        if (part.fieldname === 'entryPage' && typeof part.value === 'string') {
          entryPage = part.value;
        }
        continue;
      }
      if (part.fieldname !== 'file' || files) {
        part.file.resume();
        continue;
      }
      const ext = extensionOf((part.filename ?? '').toLowerCase());
      if (ext === 'zip') {
        tmpDir = await mkdtemp(path.join(tmpdir(), 'hpe-upload-'));
        const zipPath = path.join(tmpDir, 'upload.zip');
        await pipeline(part.file, createWriteStream(zipPath));
        if (part.file.truncated) {
          throw new AppError('IMPORT_ARCHIVE_TOO_LARGE', '壓縮檔超過大小上限', {
            limit: UPLOAD_LIMITS.maxArchiveBytes,
          });
        }
        const size = (await stat(zipPath)).size;
        files = await extractZip(zipPath, size);
      } else if (ext === 'html' || ext === 'htm') {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of part.file) {
          size += (chunk as Buffer).length;
          if (size > UPLOAD_LIMITS.maxSingleHtmlBytes) {
            throw new AppError('IMPORT_ARCHIVE_TOO_LARGE', 'HTML 超過大小上限', {
              limit: UPLOAD_LIMITS.maxSingleHtmlBytes,
            });
          }
          chunks.push(chunk as Buffer);
        }
        files = singleHtmlBundle(Buffer.concat(chunks, size));
      } else {
        part.file.resume();
        throw new AppError('IMPORT_EXTENSION_NOT_ALLOWED', '只接受 .html、.htm 或 .zip 檔案');
      }
    }
  } finally {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  }
  if (!files) throw new AppError('BAD_REQUEST', '缺少 file 欄位');
  return { files, entryPage: entryPage || undefined };
}

export function registerVersionRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post(
    API_ROUTES.createVersion.path,
    { bodyLimit: JSON_BODY_LIMIT },
    async (req, reply): Promise<VersionResponse> => {
      const { project } = await accessOwnedProject(ctx, req, idParam(req.params));
      let upload: UploadResult;
      if (req.isMultipart()) {
        upload = await readMultipartUpload(req);
      } else {
        const body = parseWith(CreateVersionJsonBodySchema, req.body);
        upload = {
          files: singleHtmlBundle(Buffer.from(body.html, 'utf8')),
          entryPage: body.entryPage,
        };
      }
      const { versionId } = await importBundle(ctx, {
        projectId: project.id,
        files: upload.files,
        entryPage: upload.entryPage,
      });
      const [row] = await ctx.db
        .select()
        .from(prototypeVersions)
        .where(eq(prototypeVersions.id, versionId));
      void reply.code(201);
      return { version: toVersion(row!) };
    },
  );

  app.get(API_ROUTES.getVersion.path, async (req): Promise<VersionDetailResponse> => {
    const { version, project, role, principal } = await accessVersion(
      ctx,
      req,
      idParam(req.params),
    );
    // 分享連結使用者看不到尚未可用的版本
    if (role !== 'owner' && version.status !== 'ready') throw new AppError('NOT_FOUND');
    return {
      version: toVersion(version),
      project: toProject(project),
      role,
      me: authorOf(principal),
    };
  });

  app.patch(API_ROUTES.updateVersion.path, async (req): Promise<VersionResponse> => {
    const { version } = await accessOwnedVersion(ctx, req, idParam(req.params));
    const body = parseWith(UpdateVersionBodySchema, req.body);
    const set: Partial<typeof prototypeVersions.$inferInsert> = {};

    if (body.cdnAllowlist !== undefined) {
      const origins = [...new Set(body.cdnAllowlist.map((u) => new URL(u).origin))];
      const bad = origins.filter((o) => !CDN_ORIGINS.has(o));
      if (bad.length > 0) {
        throw new AppError('BAD_REQUEST', 'cdnAllowlist 只能使用預設清單內的 origin', {
          rejected: bad,
        });
      }
      set.cdnAllowlist = origins;
      set.analysis = recomputeBlocked(version.analysis, origins);
    }
    if (body.entryPage !== undefined) {
      const decision = detectEntry(version.pages, body.entryPage);
      set.entryPage = decision.entryPage;
      set.status = 'ready';
      set.entryCandidates = null;
    }
    if (Object.keys(set).length === 0) return { version: toVersion(version) };
    const [row] = await ctx.db
      .update(prototypeVersions)
      .set(set)
      .where(eq(prototypeVersions.id, version.id))
      .returning();
    return { version: toVersion(row!) };
  });

  app.delete(API_ROUTES.deleteVersion.path, async (req) => {
    const { version, principal } = await accessOwnedVersion(ctx, req, idParam(req.params));
    const shas = (
      await ctx.db
        .selectDistinct({ sha: assets.sha256 })
        .from(assets)
        .where(eq(assets.versionId, version.id))
    ).map((r) => r.sha);
    await ctx.db.transaction(async (tx) => {
      await tx.delete(prototypeVersions).where(eq(prototypeVersions.id, version.id));
      await writeAudit(tx, {
        actor: actorLabel(principal),
        action: 'version.delete',
        target: version.id,
        meta: { projectId: version.projectId, number: version.number },
      });
    });
    await gcBlobs(ctx, shas);
    return { ok: true };
  });

  app.post(API_ROUTES.rotateContentKey.path, async (req): Promise<VersionResponse> => {
    const { version, principal } = await accessOwnedVersion(ctx, req, idParam(req.params));
    const row = await ctx.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(prototypeVersions)
        .set({ contentKey: newContentKey() })
        .where(eq(prototypeVersions.id, version.id))
        .returning();
      await writeAudit(tx, {
        actor: actorLabel(principal),
        action: 'version.rotate_content_key',
        target: version.id,
        // 只記錄舊 key 的前 6 碼，避免審計日誌變成存取憑證清單
        meta: { projectId: version.projectId, oldKeyPrefix: version.contentKey.slice(0, 6) },
      });
      return updated!;
    });
    return { version: toVersion(row) };
  });
}
