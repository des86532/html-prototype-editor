import {
  API_HEADERS,
  API_ROUTES,
  AppError,
  type AssetManifestEntry,
  type InternalContentResponse,
} from '@hpe/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import type { AppContext } from '../context.js';
import { assets, prototypeVersions } from '../db/schema.js';
import { CONTENT_KEY_RE, safeEqual } from '../ids.js';
import { idParam } from '../http.js';
import { SHA256_RE } from '../storage/types.js';

/** content server 專用端點：以共享的 INTERNAL_TOKEN 驗證（常數時間比較）。 */
export function registerInternalRoutes(app: FastifyInstance, ctx: AppContext) {
  const guard: preHandlerAsyncHookHandler = async (req) => {
    const given = req.headers[API_HEADERS.internalToken];
    if (typeof given !== 'string' || !safeEqual(given, ctx.config.internalToken)) {
      throw new AppError('UNAUTHENTICATED', 'internal token 錯誤');
    }
  };

  app.get(
    API_ROUTES.internalContent.path,
    { preHandler: guard },
    async (req): Promise<InternalContentResponse> => {
      const contentKey = idParam(req.params);
      // 換掉的 contentKey 立刻查不到 → content server 回 404
      if (!CONTENT_KEY_RE.test(contentKey)) throw new AppError('NOT_FOUND');
      const [version] = await ctx.db
        .select()
        .from(prototypeVersions)
        .where(
          and(eq(prototypeVersions.contentKey, contentKey), eq(prototypeVersions.status, 'ready')),
        )
        .limit(1);
      if (!version) throw new AppError('NOT_FOUND');
      const rows = await ctx.db.select().from(assets).where(eq(assets.versionId, version.id));
      const manifest: AssetManifestEntry[] = rows.map((r) => ({
        path: r.path,
        sha256: r.sha256,
        size: r.size,
        mime: r.mime,
      }));
      return {
        versionId: version.id,
        contentKey: version.contentKey,
        entryPage: version.entryPage,
        cdnAllowlist: version.cdnAllowlist,
        assets: manifest,
      };
    },
  );

  app.get(API_ROUTES.internalBlob.path, { preHandler: guard }, async (req, reply) => {
    const sha = idParam(req.params);
    if (!SHA256_RE.test(sha)) throw new AppError('NOT_FOUND');
    // 只有被某個 asset 參照的 blob 才會提供
    const [ref] = await ctx.db
      .select({ size: assets.size })
      .from(assets)
      .where(eq(assets.sha256, sha))
      .limit(1);
    if (!ref) throw new AppError('NOT_FOUND');
    const stream = await ctx.storage.get(sha);
    return reply
      .header('content-type', 'application/octet-stream')
      .header('content-length', String(ref.size))
      .header('cache-control', 'private, max-age=31536000, immutable')
      .send(stream);
  });
}
