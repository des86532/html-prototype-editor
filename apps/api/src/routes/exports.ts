import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
  API_ROUTES,
  AppError,
  CDN_PRESETS,
  ThreadStatusSchema,
  ThreadTagSchema,
  UPLOAD_LIMITS,
  type Author,
  type ExportEstimateResponse,
  type ExportFormat,
  type Thread,
  type VersionResponse,
} from '@hpe/shared';
import {
  EXPORT_WARN_BYTES,
  buildAnnotationsDocument,
  buildCsv,
  buildMarkdown,
  buildReviewPackage,
  buildSingleFileHtml,
  exportFilename,
  inlineAssets,
  parseReviewPackage,
  reviewPackageToImportDraft,
  toJson,
  type Bundle,
  type ExportInput,
} from '@hpe/exporter';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { writeAudit } from '../audit.js';
import { accessOwnedProject, accessOwnedVersion } from '../auth/access.js';
import { actorLabel } from '../auth/principal.js';
import type { AppContext } from '../context.js';
import { assets, comments, prototypeVersions, threads } from '../db/schema.js';
import { authorId, toVersion } from '../dto.js';
import { idParam, parseWith } from '../http.js';
import { newId } from '../ids.js';
import { extractZip } from '../import/extractZip.js';
import { importBundle } from '../import/pipeline.js';
import { extensionOf, isPagePath, type BundleFile } from '../import/validateEntries.js';
import { listVersionThreads, nextThreadNumber } from './threads.js';

const FORMATS = ['json', 'markdown', 'csv', 'html', 'package'] as const;
const QuerySchema = z.object({
  status: ThreadStatusSchema.optional(),
  tag: ThreadTagSchema.optional(),
});
const CDN_ORIGINS: ReadonlySet<string> = new Set(CDN_PRESETS.flatMap((p) => p.origins));

const FORMAT_META: Record<ExportFormat, { ext: string; type: string }> = {
  json: { ext: 'json', type: 'application/json; charset=utf-8' },
  markdown: { ext: 'md', type: 'text/markdown; charset=utf-8' },
  csv: { ext: 'csv', type: 'text/csv; charset=utf-8' },
  html: { ext: 'html', type: 'text/html; charset=utf-8' },
  package: { ext: 'zip', type: 'application/zip' },
};

async function readBuildArtefact(file: string, what: string, hint: string): Promise<string> {
  try {
    return await readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new AppError('INTERNAL', `找不到${what}：${file}。請先建置：${hint}`);
    }
    throw err;
  }
}

async function loadBundle(ctx: AppContext, versionId: string): Promise<Bundle> {
  const rows = await ctx.db.select().from(assets).where(eq(assets.versionId, versionId));
  const bundle = new Map<string, { data: Uint8Array; mime: string }>();
  for (const row of rows) {
    const stream = await ctx.storage.get(row.sha256);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
    bundle.set(row.path, { data: Buffer.concat(chunks), mime: row.mime });
  }
  return bundle;
}

function filterThreads(all: Thread[], q: z.infer<typeof QuerySchema>): Thread[] {
  return all.filter(
    (t) => (!q.status || t.status === q.status) && (!q.tag || t.tags.includes(q.tag)),
  );
}

/** 匯入的作者不會連結到真實帳號：一律以 guest 形式保存（user → guestId `imported:<userId>`）。 */
function importedAuthor(a: Author): Author {
  return a.kind === 'user'
    ? { kind: 'guest', guestId: `imported:${a.userId}`, name: a.name }
    : { kind: 'guest', guestId: a.guestId, name: a.name };
}

function parseDate(s: string | undefined, fallback: Date): Date {
  if (!s) return fallback;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

export function registerExportRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get(API_ROUTES.exportEstimate.path, async (req): Promise<ExportEstimateResponse> => {
    const { version } = await accessOwnedVersion(ctx, req, idParam(req.params));
    const q = parseWith(QuerySchema, req.query, '查詢參數');
    const all = filterThreads(await listVersionThreads(ctx.db, version.id), q);
    const bundle = await loadBundle(ctx, version.id);
    const { report } = inlineAssets({ bundle });
    const annotationBytes = Buffer.byteLength(
      toJson(
        buildAnnotationsDocument({
          project: { id: version.projectId, name: '' },
          version: toVersion(version),
          threads: all,
        }),
      ),
    );
    let overhead = 0;
    for (const f of [ctx.config.exportShellPath, ctx.config.agentBundlePath]) {
      overhead += await stat(f).then(
        (s) => s.size,
        () => 0,
      );
    }
    const htmlBytes = report.totalBytes + annotationBytes + overhead;
    let packageBytes = annotationBytes;
    for (const f of bundle.values()) packageBytes += f.data.byteLength;
    return {
      htmlBytes,
      packageBytes,
      threadCount: all.length,
      warnLargeHtml: htmlBytes > EXPORT_WARN_BYTES,
    };
  });

  app.get(API_ROUTES.exportVersion.path, async (req, reply) => {
    const { version, project, principal } = await accessOwnedVersion(ctx, req, idParam(req.params));
    const format = (req.params as { format?: string }).format;
    if (!FORMATS.includes(format as ExportFormat)) {
      throw new AppError('BAD_REQUEST', `不支援的匯出格式：${String(format).slice(0, 20)}`);
    }
    const fmt = format as ExportFormat;
    const q = parseWith(QuerySchema, req.query, '查詢參數');
    const now = ctx.now();
    const input: ExportInput = {
      project: { id: project.id, name: project.name },
      version: toVersion(version),
      threads: filterThreads(await listVersionThreads(ctx.db, version.id), q),
      now,
    };

    let body: string | Buffer;
    switch (fmt) {
      case 'json':
        body = toJson(buildAnnotationsDocument(input));
        break;
      case 'markdown':
        body = buildMarkdown(input);
        break;
      case 'csv':
        body = buildCsv(input, { bom: true });
        break;
      case 'package':
        body = Buffer.from(
          buildReviewPackage({ input, bundle: await loadBundle(ctx, version.id) }),
        );
        break;
      case 'html': {
        const shellHtml = await readBuildArtefact(
          ctx.config.exportShellPath,
          '匯出 shell（export-viewer）',
          'pnpm --filter @hpe/export-viewer build（或設定 EXPORT_SHELL_PATH）',
        );
        const agentSource = await readBuildArtefact(
          ctx.config.agentBundlePath,
          'frame-agent 建置檔',
          'pnpm --filter @hpe/frame-agent build（或設定 AGENT_BUNDLE_PATH）',
        );
        const { pages } = inlineAssets({ bundle: await loadBundle(ctx, version.id) });
        try {
          body = buildSingleFileHtml({
            shellHtml,
            annotations: buildAnnotationsDocument(input),
            pages,
            agentSource,
            meta: {
              projectName: project.name,
              versionNumber: version.number,
              entryPage: version.entryPage,
              exportedAt: now.toISOString(),
            },
          }).html;
        } catch (err) {
          throw new AppError('INTERNAL', `匯出 shell 不符合格式：${(err as Error).message}`);
        }
        break;
      }
    }

    const meta = FORMAT_META[fmt];
    const filename = exportFilename({
      projectName: project.name,
      versionNumber: version.number,
      date: now,
      ext: meta.ext,
    });
    await writeAudit(ctx.db, {
      actor: actorLabel(principal),
      action: `export.${fmt}`,
      target: version.id,
      meta: { threads: input.threads.length, bytes: Buffer.byteLength(body), ...q },
    });
    return reply
      .header('content-type', meta.type)
      .header('content-disposition', `attachment; filename="${filename}"`)
      .header('x-content-type-options', 'nosniff')
      .send(body);
  });

  app.post(API_ROUTES.importPackage.path, async (req, reply): Promise<VersionResponse> => {
    const { project, principal } = await accessOwnedProject(ctx, req, idParam(req.params));
    if (!req.isMultipart()) throw new AppError('BAD_REQUEST', '請以 multipart 上傳 file 欄位');

    let tmpDir: string | null = null;
    let validated: BundleFile[];
    let packageBytes: Buffer;
    try {
      let zipPath: string | null = null;
      for await (const part of req.parts()) {
        if (part.type === 'field') continue;
        if (part.fieldname !== 'file' || zipPath) {
          part.file.resume();
          continue;
        }
        if (extensionOf((part.filename ?? '').toLowerCase()) !== 'zip') {
          part.file.resume();
          throw new AppError('IMPORT_EXTENSION_NOT_ALLOWED', 'Review Package 必須是 .zip');
        }
        tmpDir = await mkdtemp(path.join(tmpdir(), 'hpe-package-'));
        zipPath = path.join(tmpDir, 'package.zip');
        await pipeline(part.file, createWriteStream(zipPath));
        if (part.file.truncated) {
          throw new AppError('IMPORT_ARCHIVE_TOO_LARGE', '壓縮檔超過大小上限', {
            limit: UPLOAD_LIMITS.maxArchiveBytes,
          });
        }
      }
      if (!zipPath) throw new AppError('BAD_REQUEST', '缺少 file 欄位');
      // 與一般匯入完全相同的驗證：大小、數量、壓縮比、路徑、symlink、副檔名白名單
      validated = await extractZip(zipPath, (await stat(zipPath)).size);
      packageBytes = await readFile(zipPath);
    } finally {
      if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
    }

    const pkg = parseReviewPackage(packageBytes);
    const bundleFiles: BundleFile[] = validated
      .filter((f) => f.path.startsWith('bundle/'))
      .map((f) => ({ path: f.path.slice('bundle/'.length), data: f.data }))
      .filter((f) => f.path !== '');
    if (!bundleFiles.some((f) => isPagePath(f.path))) {
      throw new AppError('IMPORT_NO_HTML', 'Review Package 的 bundle 內沒有任何 HTML 頁面');
    }
    const badOrigins = pkg.manifest.cdnAllowlist.filter((o) => !CDN_ORIGINS.has(o));
    if (badOrigins.length > 0) {
      throw new AppError('BAD_REQUEST', 'manifest 的 cdnAllowlist 含有不在預設清單內的 origin', {
        rejected: badOrigins,
      });
    }
    const entry = bundleFiles.some((f) => f.path === pkg.manifest.entryPage)
      ? pkg.manifest.entryPage
      : undefined;
    const draft = reviewPackageToImportDraft(pkg);
    const now = ctx.now();

    const { versionId } = await importBundle(ctx, {
      projectId: project.id,
      files: bundleFiles,
      entryPage: entry,
      cdnAllowlist: [...new Set(pkg.manifest.cdnAllowlist)],
      afterInsert: async (tx, { versionId: vid, projectId }) => {
        for (const t of draft.threads) {
          const threadId = newId();
          const createdBy = importedAuthor(t.createdBy);
          await tx.insert(threads).values({
            id: threadId,
            versionId: vid,
            projectId,
            number: await nextThreadNumber(tx, projectId),
            anchor: t.anchor,
            status: t.status,
            tags: [...new Set(t.tags)],
            createdBy,
            createdById: authorId(createdBy),
            createdAt: parseDate(t.createdAt, now),
            resolvedAt: t.status === 'resolved' ? parseDate(t.resolvedAt, now) : null,
          });
          for (const c of t.comments) {
            const author = importedAuthor(c.author);
            await tx.insert(comments).values({
              id: newId(),
              threadId,
              author,
              authorId: authorId(author),
              body: c.body,
              createdAt: parseDate(c.createdAt, now),
              editedAt: c.editedAt ? parseDate(c.editedAt, now) : null,
            });
          }
        }
        await writeAudit(tx, {
          actor: actorLabel(principal),
          action: 'package.import',
          target: vid,
          meta: { projectId, threads: draft.threads.length },
        });
      },
    });
    const [row] = await ctx.db
      .select()
      .from(prototypeVersions)
      .where(eq(prototypeVersions.id, versionId));
    void reply.code(201);
    return { version: toVersion(row!) };
  });
}
