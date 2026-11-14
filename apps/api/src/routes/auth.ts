import {
  API_ROUTES,
  AppError,
  MagicLinkRequestBodySchema,
  SESSION_COOKIE,
  type MagicLinkResponse,
  type MeResponse,
} from '@hpe/shared';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { writeAudit } from '../audit.js';
import { getPrincipal } from '../auth/principal.js';
import type { AppContext } from '../context.js';
import { authTokens, sessions, users } from '../db/schema.js';
import { toUser } from '../dto.js';
import { parseWith } from '../http.js';
import { newId, randomToken, sha256Hex } from '../ids.js';
import { rateLimit, type RateLimiter } from '../plugins/rateLimit.js';

export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const CallbackQuerySchema = z.object({ token: z.string().min(16).max(256) });

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext, limiter: RateLimiter) {
  const limit = rateLimit(limiter, 'authRequest');

  app.post(API_ROUTES.magicLink.path, { preHandler: limit }, async (req) => {
    const { email: rawEmail } = parseWith(MagicLinkRequestBodySchema, req.body);
    const email = rawEmail.trim().toLowerCase();
    const token = randomToken();
    await ctx.db.insert(authTokens).values({
      hash: sha256Hex(token),
      email,
      expiresAt: new Date(ctx.now().getTime() + MAGIC_LINK_TTL_MS),
      createdAt: ctx.now(),
    });
    const link = `${ctx.config.apiOrigin}${API_ROUTES.authCallback.path}?token=${token}`;
    if (ctx.config.devMagicLink) {
      return { ok: true, devLink: link } satisfies MagicLinkResponse;
    }
    try {
      await ctx.mailer.sendMagicLink(email, link);
    } catch (err) {
      // 不把寄信失敗回報給呼叫端（避免被拿來探測），只記錄
      req.log.error({ err }, 'failed to send magic link');
    }
    return { ok: true } satisfies MagicLinkResponse;
  });

  app.get(API_ROUTES.authCallback.path, { preHandler: limit }, async (req, reply) => {
    const { token } = parseWith(CallbackQuerySchema, req.query, '查詢參數');
    const now = ctx.now();
    // 原子地「使用」token：只有未使用且未過期的才會更新成功，確保單次使用
    const [used] = await ctx.db
      .update(authTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(authTokens.hash, sha256Hex(token)),
          isNull(authTokens.usedAt),
          gt(authTokens.expiresAt, now),
        ),
      )
      .returning({ email: authTokens.email });
    if (!used) throw new AppError('BAD_REQUEST', '登入連結無效或已過期，請重新取得');

    await ctx.db
      .insert(users)
      .values({ id: newId(), email: used.email, name: used.email.split('@')[0] || used.email })
      .onConflictDoNothing({ target: users.email });
    const [user] = await ctx.db.select().from(users).where(eq(users.email, used.email)).limit(1);
    if (!user) throw new AppError('INTERNAL');

    const sessionToken = randomToken();
    await ctx.db.insert(sessions).values({
      hash: sha256Hex(sessionToken),
      userId: user.id,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      createdAt: now,
    });
    await writeAudit(ctx.db, { actor: `user:${user.id}`, action: 'auth.login', target: user.id });

    void reply.setCookie(SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: ctx.config.secureCookies,
      path: '/',
      maxAge: SESSION_TTL_MS / 1000,
    });
    return reply.redirect(ctx.config.appOrigin, 302);
  });

  app.post(API_ROUTES.logout.path, async (req, reply) => {
    const cookie = req.cookies[SESSION_COOKIE];
    if (cookie) await ctx.db.delete(sessions).where(eq(sessions.hash, sha256Hex(cookie)));
    void reply.clearCookie(SESSION_COOKIE, {
      httpOnly: true,
      sameSite: 'lax',
      secure: ctx.config.secureCookies,
      path: '/',
    });
    return { ok: true };
  });

  app.get(API_ROUTES.me.path, async (req): Promise<MeResponse> => {
    const p = await getPrincipal(ctx, req);
    if (p.kind !== 'user') throw new AppError('UNAUTHENTICATED', '請先登入');
    return { user: toUser(p.user) };
  });
}
