import {
  API_ROUTES,
  AppError,
  DevLoginBodySchema,
  OAUTH_COOKIE,
  SESSION_COOKIE,
  type MeResponse,
} from '@hpe/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { writeAudit } from '../audit.js';
import { pkceChallenge, type GoogleIdentity } from '../auth/google.js';
import { getPrincipal } from '../auth/principal.js';
import type { AppContext } from '../context.js';
import { sessions, users } from '../db/schema.js';
import { toUser } from '../dto.js';
import { parseWith } from '../http.js';
import { newId, randomToken, safeEqual, sha256Hex } from '../ids.js';
import { rateLimit, type RateLimiter } from '../plugins/rateLimit.js';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const OAUTH_COOKIE_TTL_S = 600;

type UserRow = typeof users.$inferSelect;

const CallbackQuerySchema = z.object({
  code: z.string().min(1).max(2048).optional(),
  state: z.string().max(256).optional(),
  error: z.string().max(256).optional(),
});

async function startSession(
  ctx: AppContext,
  reply: FastifyReply,
  user: UserRow,
  provider: 'google' | 'dev',
): Promise<void> {
  const now = ctx.now();
  const sessionToken = randomToken();
  await ctx.db.insert(sessions).values({
    hash: sha256Hex(sessionToken),
    userId: user.id,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    createdAt: now,
  });
  await writeAudit(ctx.db, {
    actor: `user:${user.id}`,
    action: 'auth.login',
    target: user.id,
    meta: { provider },
  });
  void reply.setCookie(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: ctx.config.secureCookies,
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
}

/** 依 sub 找；找不到則依 email 綁定既有帳號；都沒有就建立。email 已綁其他 sub → 'conflict'。 */
async function upsertGoogleUser(
  ctx: AppContext,
  id: GoogleIdentity,
): Promise<UserRow | 'conflict'> {
  const [bySub] = await ctx.db.select().from(users).where(eq(users.googleSub, id.sub)).limit(1);
  if (bySub) return bySub;

  const [byEmail] = await ctx.db.select().from(users).where(eq(users.email, id.email)).limit(1);
  if (byEmail) {
    if (byEmail.googleSub !== null) return 'conflict';
    const [bound] = await ctx.db
      .update(users)
      .set({ googleSub: id.sub })
      .where(eq(users.id, byEmail.id))
      .returning();
    if (!bound) throw new AppError('INTERNAL');
    return bound;
  }

  const [created] = await ctx.db
    .insert(users)
    .values({
      id: newId(),
      email: id.email,
      name: id.name?.trim() || id.email.split('@')[0] || id.email,
      googleSub: id.sub,
    })
    .returning();
  if (!created) throw new AppError('INTERNAL');
  return created;
}

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext, limiter: RateLimiter) {
  const limit = rateLimit(limiter, 'authRequest');
  const oauthCookieOpts = {
    httpOnly: true,
    sameSite: 'lax',
    secure: ctx.config.secureCookies,
    // /auth/google 也涵蓋 /auth/google/callback
    path: API_ROUTES.googleLogin.path,
  } as const;
  const redirectUri = ctx.config.apiOrigin + API_ROUTES.googleCallback.path;
  const loginRedirect = (code: string) => `${ctx.config.appOrigin}/login?error=${code}`;

  app.get(API_ROUTES.googleLogin.path, { preHandler: limit }, async (_req, reply) => {
    if (!ctx.google) return reply.redirect(loginRedirect('google_not_configured'), 302);
    const state = randomToken();
    const verifier = randomToken();
    const nonce = randomToken();
    // 不簽章：防 CSRF 靠 state 比對，且此 cookie 只能由 API origin 設定
    void reply.setCookie(OAUTH_COOKIE, `${state}.${verifier}.${nonce}`, {
      ...oauthCookieOpts,
      maxAge: OAUTH_COOKIE_TTL_S,
    });
    return reply.redirect(
      ctx.google.authorizeUrl({
        state,
        nonce,
        codeChallenge: pkceChallenge(verifier),
        redirectUri,
      }),
      302,
    );
  });

  app.get(API_ROUTES.googleCallback.path, { preHandler: limit }, async (req, reply) => {
    // 使用者是瀏覽器頂層導覽進來的，一律以導向回報錯誤，不回 JSON
    const fail = (code: string) => {
      void reply.clearCookie(OAUTH_COOKIE, oauthCookieOpts);
      return reply.redirect(loginRedirect(code), 302);
    };
    if (!ctx.google) return fail('google_not_configured');

    const parsed = CallbackQuerySchema.safeParse(req.query);
    if (!parsed.success) return fail('google_state');
    const { code, state, error } = parsed.data;
    if (error) return fail('google_denied');

    const parts = (req.cookies[OAUTH_COOKIE] ?? '').split('.');
    const [cookieState, codeVerifier, cookieNonce] = parts;
    if (
      parts.length !== 3 ||
      !cookieState ||
      !codeVerifier ||
      !cookieNonce ||
      !code ||
      !state ||
      !safeEqual(state, cookieState)
    ) {
      return fail('google_state');
    }

    let identity: GoogleIdentity;
    try {
      identity = await ctx.google.exchangeCode({ code, codeVerifier, redirectUri });
    } catch (err) {
      req.log.warn({ err }, 'google token exchange failed');
      return fail('google_failed');
    }
    if (identity.nonce !== cookieNonce) return fail('google_failed');
    if (!identity.emailVerified) return fail('google_email_unverified');

    const user = await upsertGoogleUser(ctx, identity);
    if (user === 'conflict') return fail('google_conflict');

    void reply.clearCookie(OAUTH_COOKIE, oauthCookieOpts);
    await startSession(ctx, reply, user, 'google');
    return reply.redirect(ctx.config.appOrigin, 302);
  });

  app.post(API_ROUTES.devLogin.path, { preHandler: limit }, async (req, reply) => {
    if (!ctx.config.devLogin) throw new AppError('NOT_FOUND');
    const { email: rawEmail } = parseWith(DevLoginBodySchema, req.body);
    const email = rawEmail.trim().toLowerCase();
    await ctx.db
      .insert(users)
      .values({ id: newId(), email, name: email.split('@')[0] || email })
      .onConflictDoNothing({ target: users.email });
    const [user] = await ctx.db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user) throw new AppError('INTERNAL');
    await startSession(ctx, reply, user, 'dev');
    return { user: toUser(user) } satisfies MeResponse;
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
