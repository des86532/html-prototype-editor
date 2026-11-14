import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { AppError, UPLOAD_LIMITS } from '@hpe/shared';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { AppContext, AppDeps } from './context.js';
import { RateLimiter } from './plugins/rateLimit.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerCspRoutes } from './routes/csp.js';
import { registerExportRoutes } from './routes/exports.js';
import { registerInternalRoutes } from './routes/internal.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerShareRoutes } from './routes/share.js';
import { registerThreadRoutes } from './routes/threads.js';
import { registerVersionRoutes } from './routes/versions.js';

export interface BuildAppOptions {
  logger?: boolean;
  /** 測試可注入自訂 limiter（例如固定時鐘）。 */
  limiter?: RateLimiter;
}

export async function buildApp(
  deps: AppDeps,
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const ctx: AppContext = { ...deps, now: deps.now ?? (() => new Date()) };
  const { config } = ctx;
  const limiter = options.limiter ?? new RateLimiter(config.rateLimits);

  const app = Fastify({
    logger: options.logger ?? false,
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024,
    // Fastify 預設會對 __proto__ 等做檢查；保留預設行為
  });

  await app.register(cors, {
    origin: config.appOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'x-share-token', 'x-guest-token'],
    exposedHeaders: ['content-disposition', 'retry-after'],
    maxAge: 600,
  });
  await app.register(cookie);
  await app.register(multipart, {
    limits: {
      fileSize: UPLOAD_LIMITS.maxArchiveBytes,
      files: 1,
      fields: 8,
      fieldSize: 4096,
      parts: 12,
    },
  });

  app.addHook('onSend', async (_req, reply) => {
    void reply.header('x-content-type-options', 'nosniff');
    void reply.header('referrer-policy', 'no-referrer');
    void reply.header('x-frame-options', 'DENY');
    void reply.header('cross-origin-resource-policy', 'same-site');
    void reply.header('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
    if (!reply.hasHeader('cache-control')) void reply.header('cache-control', 'no-store');
    if (config.secureCookies) {
      void reply.header('strict-transport-security', 'max-age=63072000; includeSubDomains');
    }
  });

  app.setNotFoundHandler(async (_req, reply) => {
    return reply.code(404).send(new AppError('NOT_FOUND').toBody());
  });

  app.setErrorHandler(async (err: FastifyError | AppError | ZodError, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.status).send(err.toBody());
    }
    if (err instanceof ZodError) {
      const e = new AppError('BAD_REQUEST', '請求內容格式不正確', { issues: err.issues });
      return reply.code(e.status).send(e.toBody());
    }
    const fe = err as FastifyError;
    if (fe.code === 'FST_REQ_FILE_TOO_LARGE' || fe.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      const e = new AppError('IMPORT_ARCHIVE_TOO_LARGE', '上傳內容超過大小上限');
      return reply.code(e.status).send(e.toBody());
    }
    if (
      fe.code?.startsWith('FST_') &&
      fe.statusCode &&
      fe.statusCode >= 400 &&
      fe.statusCode < 500
    ) {
      const e = new AppError('BAD_REQUEST', fe.message);
      return reply.code(e.status).send(e.toBody());
    }
    req.log.error({ err }, 'unhandled error');
    const e = new AppError('INTERNAL', '伺服器發生錯誤');
    return reply.code(e.status).send(e.toBody());
  });

  app.get('/healthz', async () => ({ ok: true }));

  registerAuthRoutes(app, ctx, limiter);
  registerProjectRoutes(app, ctx);
  registerVersionRoutes(app, ctx);
  registerThreadRoutes(app, ctx, limiter);
  registerShareRoutes(app, ctx, limiter);
  registerInternalRoutes(app, ctx);
  registerCspRoutes(app, ctx, limiter);
  registerExportRoutes(app, ctx);

  return app;
}
