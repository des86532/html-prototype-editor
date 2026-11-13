/// <reference lib="dom" />
import { MESSAGE_LIMITS } from '@hpe/shared';
import { isStableClass, isStableId, safeQueryAll } from './util.js';

const MAX_CLASSES_PER_SEGMENT = 3;

function stableClasses(el: Element): string[] {
  return Array.from(el.classList).filter(isStableClass).sort().slice(0, MAX_CLASSES_PER_SEGMENT);
}

function segmentBase(el: Element, classes: string[]): string {
  return el.localName + classes.map((c) => '.' + c).join('');
}

function segment(el: Element): string {
  const classes = stableClasses(el);
  const base = segmentBase(el, classes);
  const parent = el.parentElement;
  if (!parent) return base;
  let ambiguous = false;
  let index = 0;
  for (let i = 0; i < parent.children.length; i++) {
    const sib = parent.children[i];
    if (!sib) continue;
    if (sib === el) index = i + 1;
    else if (sib.localName === el.localName && classes.every((c) => sib.classList.contains(c))) {
      ambiguous = true;
    }
  }
  return ambiguous ? `${base}:nth-child(${index})` : base;
}

function uniqueId(el: Element): string | null {
  const id = el.getAttribute('id');
  if (!id || !isStableId(id)) return null;
  return el.ownerDocument.querySelectorAll(`#${id}`).length === 1 ? id : null;
}

/**
 * 最短的唯一 CSS path：從目標往上逐層加 segment，直到 `querySelectorAll` 恰好只命中目標。
 * 優先用穩定 id／class，避開雜湊 class；只有同層出現同 tag+class 的兄弟時才用 `:nth-child`。
 * 太長（> maxSelectorLength）時回傳 undefined。
 */
export function cssPath(el: Element): string | undefined {
  const doc = el.ownerDocument;
  const parts: string[] = [];
  for (let cur: Element | null = el; cur; cur = cur.parentElement) {
    const id = uniqueId(cur);
    parts.unshift(id ? `#${id}` : segment(cur));
    const sel = parts.join(' > ');
    const hits = safeQueryAll(doc, sel, 2);
    if (hits.length === 1 && hits[0] === el)
      return sel.length <= MESSAGE_LIMITS.maxSelectorLength ? sel : undefined;
    if (id) break;
  }
  const full = parts.join(' > ');
  return full.length <= MESSAGE_LIMITS.maxSelectorLength ? full : undefined;
}
