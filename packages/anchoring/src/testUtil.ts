/// <reference lib="dom" />
import { JSDOM } from 'jsdom';
import type { Rect } from '@hpe/shared';

export const load = (html: string): Document => new JSDOM(html).window.document;

/**
 * 決定性的假 layout（jsdom 沒有排版）：依文件順序排成一欄，寬度隨 viewport 寬度等比例縮放。
 * `data-zero` 與（viewport < 600 時的）`.desktop-only` 量到 0 大小，用來模擬隱藏。
 */
export function fakeMeasure(viewportWidth = 1440) {
  const cache = new WeakMap<Document, Map<Element, Rect>>();
  return (el: Element): Rect | null => {
    const doc = el.ownerDocument;
    let map = cache.get(doc);
    if (!map) {
      map = new Map();
      const scale = viewportWidth / 1440;
      Array.from(doc.querySelectorAll('*')).forEach((e, i) => {
        let depth = 0;
        for (let p = e.parentElement; p; p = p.parentElement) depth++;
        const zero =
          e.hasAttribute('data-zero') || (viewportWidth < 600 && e.matches('.desktop-only'));
        map!.set(e, {
          x: 8 * depth * scale,
          y: 24 * i,
          w: zero ? 0 : Math.max(10, (1200 - 8 * depth) * scale),
          h: zero ? 0 : 20,
        });
      });
      cache.set(doc, map);
    }
    return map.get(el) ?? null;
  };
}

/** 在 root 底下選取第一個出現的 `text`，回傳 Range。 */
export function selectText(root: Element, text: string): Range {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, 4);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const at = (n as Text).data.indexOf(text);
    if (at >= 0) {
      const r = doc.createRange();
      r.setStart(n, at);
      r.setEnd(n, at + text.length);
      return r;
    }
  }
  throw new Error(`text not found: ${text}`);
}
