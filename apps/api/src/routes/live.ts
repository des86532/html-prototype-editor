import {
  API_ROUTES,
  AppError,
  LIVE_CLOSE,
  LIVE_LIMITS,
  LiveClientMessageSchema,
  SESSION_COOKIE,
  TokenBucket,
} from '@hpe/shared';
import type { FastifyInstance } from 'fastify';
import type { RawData } from 'ws';
import { accessVersionFor, sessionHashOf } from '../auth/access.js';
import { authorOf, resolvePrincipal } from '../auth/principal.js';
import type { AppContext } from '../context.js';
import { authorId } from '../dto.js';
import { idParam } from '../http.js';
import { newId } from '../ids.js';
import type { LiveConn } from '../live/hub.js';

function closeCodeFor(err: unknown): number {
  if (err instanceof AppError) {
    switch (err.code) {
      case 'UNAUTHENTICATED':
        return LIVE_CLOSE.unauthenticated;
      case 'SHARE_REVOKED':
      case 'SHARE_EXPIRED':
      case 'FORBIDDEN':
        return LIVE_CLOSE.forbidden;
      case 'NOT_FOUND':
        return LIVE_CLOSE.gone;
    }
  }
  return 1011;
}

function parseClientMessage(raw: RawData) {
  try {
    const text = Array.isArray(raw)
      ? Buffer.concat(raw).toString('utf8')
      : Buffer.from(raw as Buffer).toString('utf8');
    const r = LiveClientMessageSchema.safeParse(JSON.parse(text));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export function registerLiveRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get(
    API_ROUTES.liveVersion.path,
    {
      websocket: true,
      // session cookie 會隨 WebSocket 握手送出：不檢查 Origin 就會被跨站 WebSocket 劫持
      preValidation: async (req, reply) => {
        if (req.headers.origin !== ctx.config.appOrigin) {
          return reply.code(403).send(new AppError('FORBIDDEN').toBody());
        }
      },
    },
    (socket, req) => {
      const versionId = idParam(req.params);
      let conn: LiveConn | null = null;
      let helloSeen = false;
      const helloTimer = setTimeout(
        () => socket.close(LIVE_CLOSE.badRequest, 'hello timeout'),
        ctx.config.liveHelloTimeoutMs,
      );
      const sessionCookie = req.cookies[SESSION_COOKIE];

      socket.on('close', () => {
        clearTimeout(helloTimer);
        if (conn) ctx.hub.leave(conn);
        conn = null;
      });
      socket.on('error', () => socket.terminate());

      socket.on('message', (raw: RawData) => {
        const msg = parseClientMessage(raw);
        if (!helloSeen) {
          if (msg?.type !== 'hello') {
            clearTimeout(helloTimer);
            socket.close(LIVE_CLOSE.badRequest, 'hello required');
            return;
          }
          helloSeen = true;
          clearTimeout(helloTimer);
          void (async () => {
            try {
              const principal = await resolvePrincipal(ctx, {
                shareToken: msg.shareToken,
                guestToken: msg.guestToken,
                sessionCookie,
              });
              const access = await accessVersionFor(ctx, principal, versionId);
              // 等待驗證期間連線可能已關閉
              if (socket.readyState !== 1) return;
              const id = newId();
              const author = authorOf(principal);
              const c: LiveConn = {
                id,
                socket,
                versionId: access.version.id,
                projectId: access.project.id,
                shareLinkId: principal.kind === 'share' ? principal.link.id : null,
                sessionHash:
                  principal.kind === 'user' && sessionCookie ? sessionHashOf(sessionCookie) : null,
                peer: {
                  id,
                  name: author?.name ?? '訪客',
                  colorKey: author ? authorId(author) : id,
                  pageId: null,
                  width: null,
                },
                bucket: new TokenBucket(LIVE_LIMITS.cursorPerSecond),
                alive: true,
              };
              conn = c;
              ctx.hub.join(c);
            } catch (err) {
              socket.close(closeCodeFor(err), 'denied');
            }
          })();
          return;
        }
        if (!conn || !msg) return;
        if (msg.type === 'presence') ctx.hub.updatePresence(conn, msg.pageId, msg.width);
        else if (msg.type === 'cursor') ctx.hub.relayCursor(conn, msg.x, msg.y);
      });
    },
  );
}
