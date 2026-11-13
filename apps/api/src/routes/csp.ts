import { API_ROUTES } from '@hpe/shared';
import type { FastifyInstance } from 'fastify';
import { writeAudit } from '../audit.js';
import type { AppContext } from '../context.js';
import type { RateLimiter } from '../plugins/rateLimit.js';

const MAX_REPORT_BYTES = 64 * 1024;
const MAX_STORED_CHARS = 8 * 1024;

/**
 * CSP violation 報告收集點。瀏覽器可能送 application/csp-report、application/reports+json 或任何類型，
 * 一律回 204；內容截斷後寫入 audit_log（受頻率限制，超過就直接丟棄）。
 */
export function registerCspRoutes(app: FastifyInstance, ctx: AppContext, limiter: RateLimiter) {
  void app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser(
      '*',
      { parseAs: 'buffer', bodyLimit: MAX_REPORT_BYTES },
      (_req, body, done) => {
        done(null, body);
      },
    );
    scope.setErrorHandler(async (_err, _req, reply) => reply.code(204).send());

    scope.post(API_ROUTES.cspReport.path, async (req, reply) => {
      if (limiter.take('cspReport', req.ip) === null) {
        const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
        let text = raw.slice(0, MAX_STORED_CHARS);
        try {
          text = JSON.stringify(JSON.parse(raw)).slice(0, MAX_STORED_CHARS);
        } catch {
          /* 非 JSON：保留截斷後的原文 */
        }
        try {
          await writeAudit(ctx.db, {
            actor: 'csp',
            action: 'csp.violation',
            meta: {
              report: text,
              contentType: String(req.headers['content-type'] ?? '').slice(0, 100),
            },
          });
        } catch (err) {
          req.log.error({ err }, 'failed to store csp report');
        }
      }
      return reply.code(204).send();
    });
  });
}
