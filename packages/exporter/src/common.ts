import { shapeBounds } from '@hpe/shared';
import type { Box, Markup, MarkupShape, Thread } from '@hpe/shared';
import type { ExportInput } from './types.js';

export function exportedAt(input: ExportInput): string {
  return (input.now ?? new Date()).toISOString();
}

/** 有編號的依編號排在前面，沒有編號的依建立時間排在後面。 */
export function sortThreads(threads: readonly Thread[]): Thread[] {
  return [...threads].sort((a, b) => {
    if (a.number !== null && b.number !== null) return a.number - b.number;
    if (a.number !== null) return -1;
    if (b.number !== null) return 1;
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  });
}

/** 依 version.pages 順序，其後是只出現在標記的頁面。 */
export function groupByPage(
  threads: readonly Thread[],
  pageOrder: readonly string[],
): { page: string; threads: Thread[] }[] {
  const map = new Map<string, Thread[]>();
  for (const t of sortThreads(threads)) {
    const list = map.get(t.markup.pageId);
    if (list) list.push(t);
    else map.set(t.markup.pageId, [t]);
  }
  const out: { page: string; threads: Thread[] }[] = [];
  for (const p of pageOrder) {
    const list = map.get(p);
    if (list) {
      out.push({ page: p, threads: list });
      map.delete(p);
    }
  }
  for (const [page, list] of map) out.push({ page, threads: list });
  return out;
}

export function breakpointLabel(t: Thread): string {
  const { width, height } = t.markup.viewport;
  return `${width}×${height}px`;
}

export function shapeLabel(shape: MarkupShape): string {
  switch (shape.kind) {
    case 'rect':
      return '矩形';
    case 'arrow':
      return '箭頭';
    case 'pen':
      return '畫筆';
    case 'highlighter':
      return '螢光筆';
    case 'text': {
      const chars = Array.from(shape.text.replace(/\s+/g, ' ').trim());
      const shown = chars.length > 40 ? `${chars.slice(0, 40).join('')}…` : chars.join('');
      return `文字「${shown}」`;
    }
  }
}

/** 標記外框（頁面座標），四捨五入成整數。 */
export function markupBox(m: Markup): Box {
  const b = shapeBounds(m.shape);
  return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) };
}

/** 檔名用 slug：ASCII、小寫；全是 CJK 等字元時退回 `project`。 */
export function slugify(name: string): string {
  const s = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return s || 'project';
}

export function dateStamp(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** `review-{slug}-v{n}-{date}.{ext}`（單檔 HTML 用 `html`，ZIP 用 `zip`）。 */
export function exportFilename(opts: {
  projectName: string;
  versionNumber: number;
  date?: Date;
  ext: string;
}): string {
  return `review-${slugify(opts.projectName)}-v${opts.versionNumber}-${dateStamp(opts.date ?? new Date())}.${opts.ext}`;
}
