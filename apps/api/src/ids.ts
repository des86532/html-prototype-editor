import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { monotonicFactory } from 'ulid';

const nextUlid = monotonicFactory();

/** ULID（單一 process 內單調遞增，同毫秒建立的資料排序也穩定）。 */
export function newId(): string {
  return nextUlid();
}

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** 256-bit 隨機 token（base64url，43 字元）。 */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

export function base32Lower(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** 128-bit 隨機 contentKey，base32 小寫（26 字元，[a-z2-7]）。 */
export function newContentKey(): string {
  return base32Lower(randomBytes(16));
}

export const CONTENT_KEY_RE = /^[a-z2-7]{26}$/;

export function safeEqual(a: string, b: string): boolean {
  const ba = createHash('sha256').update(a).digest();
  const bb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ba, bb);
}
