import { AUTHOR_PALETTE } from './limits.js';
import type { Author } from './types.js';

/** 作者的穩定 id（userId 或 guestId），用於篩選與配色。 */
export function authorId(a: Author): string {
  return a.kind === 'user' ? a.userId : a.guestId;
}

/** FNV-1a 32-bit。 */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 依作者 id hash 從 8 色盤選一。 */
export function authorColor(a: Author): string {
  return AUTHOR_PALETTE[hashString(authorId(a)) % AUTHOR_PALETTE.length]!;
}

/** 發起者名字縮寫：英文取前兩個單字首字母，CJK 取前兩個字。 */
export function initials(name: string): string {
  const t = name.trim();
  if (!t) return '?';
  const words = t.split(/\s+/);
  if (words.length >= 2 && /^[\p{L}]/u.test(words[0]!)) {
    return (Array.from(words[0]!)[0]! + Array.from(words[1]!)[0]!).toUpperCase();
  }
  return Array.from(t).slice(0, 2).join('').toUpperCase();
}
