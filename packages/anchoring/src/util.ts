/// <reference lib="dom" />
import type { Rect } from '@hpe/shared';

/** 空白折疊並去頭尾。 */
export const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** FNV-1a 32 bit，輸出 8 位 hex。 */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const hasDigit = (s: string) => /\d/.test(s);
const hasLetter = (s: string) => /[A-Za-z]/.test(s);

/**
 * 判斷 class / id 是否「看起來是自動生成的」（CSS-in-JS、CSS modules、建置工具雜湊）。
 * 寧可誤判為雜湊（只是少一個 selector 線索），也不要把雜湊當穩定線索。
 */
export function isHashLike(name: string): boolean {
  if (name.length > 64) return true;
  if (/^(?:sc|jsx|svelte)-[A-Za-z0-9]{4,}$/.test(name)) return true;
  if (/^(?:css|emotion)-(?=[a-z0-9]*\d)[a-z0-9]{4,}/i.test(name)) return true;
  if (
    /^_[A-Za-z0-9_-]{4,}$/.test(name) &&
    (hasDigit(name) || (/[a-z]/.test(name) && /[A-Z]/.test(name)))
  ) {
    return true;
  }
  if (/^[0-9a-f]{6,}$/i.test(name) && hasDigit(name)) return true;
  if (/\d{4,}/.test(name)) return true;
  if (/^[:«]/.test(name) || /^(?:radix|react-aria|headlessui)-/.test(name)) return true;
  // CSS modules：Button_root__3xK2a、foo_bar_aB3dE
  if (name.includes('_')) {
    const tail = name.split(/__|_/).pop() ?? '';
    if (
      /^[A-Za-z0-9]{5,10}$/.test(tail) &&
      ((hasDigit(tail) && hasLetter(tail)) || /^[a-z]+[A-Z]/.test(tail))
    ) {
      return true;
    }
  }
  for (const tok of name.split(/[-_]/)) {
    if (tok.length >= 5 && hasDigit(tok) && hasLetter(tok)) return true;
    if (tok.length >= 5 && tok.length <= 8 && (tok.slice(1).match(/[A-Z]/g)?.length ?? 0) >= 2)
      return true;
  }
  return false;
}

const SAFE_IDENT = /^[A-Za-z_][\w-]*$/;

/** 可直接寫進 CSS selector 而不需跳脫、且不像雜湊的 class。 */
export const isStableClass = (c: string): boolean => SAFE_IDENT.test(c) && !isHashLike(c);
export const isStableId = (id: string): boolean => SAFE_IDENT.test(id) && !isHashLike(id);

export function defaultMeasure(el: Element): Rect | null {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

export const clamp01 = (n: number): number =>
  Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;

/** 元素在父層 element children 中的索引。 */
export function siblingIndex(el: Element): number {
  const p = el.parentElement;
  return p ? Array.prototype.indexOf.call(p.children, el) : 0;
}

export function depthOf(el: Element): number {
  let d = 0;
  for (let n = el.parentElement; n; n = n.parentElement) d++;
  return d;
}

export function safeQueryAll(root: ParentNode, selector: string, limit = 50): Element[] {
  try {
    const list = root.querySelectorAll(selector);
    return Array.from(list).slice(0, limit);
  } catch {
    return [];
  }
}

export const isElement = (n: Node | null | undefined): n is Element => !!n && n.nodeType === 1;

export function elementOf(n: Node | null): Element | null {
  while (n && n.nodeType !== 1) n = n.parentNode;
  return n as Element | null;
}
