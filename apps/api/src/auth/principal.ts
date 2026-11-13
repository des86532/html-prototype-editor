import { API_HEADERS, AppError, SESSION_COOKIE, type Author } from '@hpe/shared';
import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { AppContext } from '../context.js';
import { shareLinks, sessions, users } from '../db/schema.js';
import type { ShareLinkRow, UserRow } from '../dto.js';
import { sha256Hex } from '../ids.js';
import { verifyGuestToken } from './guest.js';

export interface GuestIdentity {
  guestId: string;
  name: string;
}

export type Principal =
  | { kind: 'anonymous' }
  | { kind: 'user'; user: UserRow }
  | {
      kind: 'share';
      link: ShareLinkRow;
      role: 'commenter' | 'viewer';
      guest: GuestIdentity | null;
    };

const cache = new WeakMap<FastifyRequest, Promise<Principal>>();

function header(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * 以 share token 查 share link。撤銷 → SHARE_REVOKED、過期 → SHARE_EXPIRED（都是 403）；
 * 查無此 token → NOT_FOUND（不洩漏 token 是否存在過）。
 */
export async function loadShareLink(ctx: AppContext, token: string): Promise<ShareLinkRow> {
  const [link] = await ctx.db
    .select()
    .from(shareLinks)
    .where(eq(shareLinks.tokenHash, sha256Hex(token)))
    .limit(1);
  if (!link) throw new AppError('NOT_FOUND');
  if (link.revokedAt) throw new AppError('SHARE_REVOKED', '此分享連結已被撤銷');
  if (link.expiresAt && link.expiresAt.getTime() <= ctx.now().getTime()) {
    throw new AppError('SHARE_EXPIRED', '此分享連結已過期');
  }
  return link;
}

async function resolve(ctx: AppContext, req: FastifyRequest): Promise<Principal> {
  const shareToken = header(req, API_HEADERS.shareToken);
  if (shareToken) {
    const link = await loadShareLink(ctx, shareToken);
    let guest: GuestIdentity | null = null;
    const guestToken = header(req, API_HEADERS.guestToken);
    if (guestToken) {
      const claims = verifyGuestToken(guestToken, ctx.config.sessionSecret);
      if (claims && claims.pid === link.projectId)
        guest = { guestId: claims.gid, name: claims.name };
    }
    return { kind: 'share', link, role: link.role, guest };
  }

  const cookie = req.cookies[SESSION_COOKIE];
  if (cookie) {
    const [row] = await ctx.db
      .select({ user: users, expiresAt: sessions.expiresAt })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.hash, sha256Hex(cookie)))
      .limit(1);
    if (row && row.expiresAt.getTime() > ctx.now().getTime()) {
      return { kind: 'user', user: row.user };
    }
  }
  return { kind: 'anonymous' };
}

/** 同一個 request 只解析一次。有 x-share-token 時一律以分享連結身分處理（權限較小）。 */
export function getPrincipal(ctx: AppContext, req: FastifyRequest): Promise<Principal> {
  let p = cache.get(req);
  if (!p) {
    p = resolve(ctx, req);
    cache.set(req, p);
  }
  return p;
}

export async function requireUser(ctx: AppContext, req: FastifyRequest): Promise<UserRow> {
  const p = await getPrincipal(ctx, req);
  if (p.kind === 'user') return p.user;
  if (p.kind === 'share') throw new AppError('FORBIDDEN', '此操作僅限專案擁有者');
  throw new AppError('UNAUTHENTICATED', '請先登入');
}

/** 目前身分的留言作者資料；匿名或尚未填名字的分享連結使用者回傳 null。 */
export function authorOf(p: Principal): Author | null {
  if (p.kind === 'user') return { kind: 'user', userId: p.user.id, name: p.user.name };
  if (p.kind === 'share' && p.guest) {
    return { kind: 'guest', guestId: p.guest.guestId, name: p.guest.name };
  }
  return null;
}

/** 審計日誌用的 actor 標籤。 */
export function actorLabel(p: Principal): string {
  if (p.kind === 'user') return `user:${p.user.id}`;
  if (p.kind === 'share') return p.guest ? `guest:${p.guest.guestId}` : `share:${p.link.id}`;
  return 'anonymous';
}
