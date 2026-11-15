import { readFile, stat } from 'node:fs/promises';
import {
  API_ROUTES,
  AppError,
  ThreadStatusSchema,
  type ExportEstimateResponse,
  type ExportFormat,
  type Thread,
} from '@hpe/shared';
import {
  EXPORT_WARN_BYTES,
  buildAnnotationsDocument,
  buildMarkdown,
  buildSingleFileHtml,
  exportFilename,
  inlineAssets,
  toJson,
  type Bundle,
  type ExportInput,
} from '@hpe/exporter';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { writeAudit } from '../audit.js';
import { accessOwnedVersion } from '../auth/access.js';
import { actorLabel } from '../auth/principal.js';
import type { AppContext } from '../context.js';
import { assets } from '../db/schema.js';
import { toVersion } from '../dto.js';
import { idParam, parseWith } from '../http.js';
import { listVersionThreads } from './threads.js';

const FORMATS = ['json', 'markdown', 'html'] as const;
const QuerySchema = z.object({
  status: ThreadStatusSchema.optional(),
});

const FORMAT_META: Record<ExportFormat, { ext: string; type: string }> = {
  json: { ext: 'json', type: 'application/json; charset=utf-8' },
  markdown: { ext: 'md', type: 'text/markdown; charset=utf-8' },
  html: { ext: 'html', type: 'text/html; charset=utf-8' },
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
  return all.filter((t) => !q.status || t.status === q.status);
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
    return {
      htmlBytes,
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
}
