import { createHmac, timingSafeEqual } from 'node:crypto';

export interface GuestClaims {
  /** guestId */
  gid: string;
  name: string;
  /** 綁定的 project id */
  pid: string;
}

/** `base64url(json{gid,name,pid}).sig`，sig = HMAC-SHA256(SESSION_SECRET, payload)。 */
export function signGuestToken(claims: GuestClaims, secret: string): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyGuestToken(token: string, secret: string): GuestClaims | null {
  const dot = token.indexOf('.');
  if (dot <= 0 || token.indexOf('.', dot + 1) !== -1) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac('sha256', secret).update(payload).digest();
  let given: Buffer;
  try {
    given = Buffer.from(sig, 'base64url');
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as GuestClaims).gid === 'string' &&
      typeof (parsed as GuestClaims).name === 'string' &&
      typeof (parsed as GuestClaims).pid === 'string'
    ) {
      const { gid, name, pid } = parsed as GuestClaims;
      return { gid, name, pid };
    }
  } catch {
    /* fallthrough */
  }
  return null;
}
