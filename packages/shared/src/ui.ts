import { PIN_PALETTE } from './limits.js';
import type { Author, Thread, ThreadFilters } from './types.js';

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

/** 依作者 id hash 從 8 色盤選一（規格：Pin 外觀）。 */
export function pinColor(a: Author): string {
  return PIN_PALETTE[hashString(authorId(a)) % PIN_PALETTE.length]!;
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

/** 留言面板與畫面 pin 共用的篩選（狀態、頁面、寬度、作者、標籤）。 */
export function matchesFilters(t: Thread, f: ThreadFilters): boolean {
  if (f.status !== 'all' && t.status !== f.status) return false;
  if (f.pageId !== null && t.anchor.pageId !== f.pageId) return false;
  if (f.width !== null && Math.round(t.anchor.viewport.width) !== Math.round(f.width)) return false;
  if (f.authorId !== null && authorId(t.createdBy) !== f.authorId) return false;
  if (f.tag !== null && !t.tags.includes(f.tag)) return false;
  return true;
}

/**
 * Pin 錨點（規格「Pin 位置公式」），單位為 parent 螢幕 px：
 * `(rect.x + elementOffset.x * rect.w, rect.y + elementOffset.y * rect.h) * scale + frameOffset`；
 * 區域評論放在區域框右上角，文字評論放在選取範圍右上角（rect 已是最後一個 client rect）。
 */
export function pinPoint(
  kind: 'element' | 'region' | 'text',
  rect: { x: number; y: number; w: number; h: number },
  elementOffset: { x: number; y: number },
  scale: number,
  frameOffset: { x: number; y: number },
): { x: number; y: number } {
  const local =
    kind === 'element'
      ? { x: rect.x + elementOffset.x * rect.w, y: rect.y + elementOffset.y * rect.h }
      : { x: rect.x + rect.w, y: rect.y };
  return { x: local.x * scale + frameOffset.x, y: local.y * scale + frameOffset.y };
}
