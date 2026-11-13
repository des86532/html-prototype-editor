import type { Thread } from '@hpe/shared';
import type { ExportInput } from './types.js';

export function exportedAt(input: ExportInput): string {
  return (input.now ?? new Date()).toISOString();
}

/** 以專案內編號排序（與 pin 編號一致）。 */
export function sortThreads(threads: readonly Thread[]): Thread[] {
  return [...threads].sort((a, b) => a.number - b.number);
}

/** 依 version.pages 順序，其後是只出現在 anchor 的頁面。 */
export function groupByPage(
  threads: readonly Thread[],
  pageOrder: readonly string[],
): { page: string; threads: Thread[] }[] {
  const map = new Map<string, Thread[]>();
  for (const t of sortThreads(threads)) {
    const list = map.get(t.anchor.pageId);
    if (list) list.push(t);
    else map.set(t.anchor.pageId, [t]);
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

/** 元素描述：`<tag> "text snippet"`（不含 selector）。 */
export function elementLabel(t: Thread): string {
  const { tag, text } = t.anchor.snapshot;
  const snippet = text.replace(/\s+/g, ' ').trim();
  const shown = snippet.length > 80 ? `${Array.from(snippet).slice(0, 80).join('')}…` : snippet;
  return shown ? `<${tag}> "${shown}"` : `<${tag}>`;
}

export function bestSelector(t: Thread): string {
  const s = t.anchor.selectors;
  if (s.css) return s.css;
  if (s.xpath) return s.xpath;
  if (s.dataAttr) return `[${s.dataAttr.name}="${s.dataAttr.value}"]`;
  return '';
}

export function breakpointLabel(t: Thread): string {
  const w = Math.round(t.anchor.viewport.width);
  return t.anchor.viewport.preset ? `${w}px (${t.anchor.viewport.preset})` : `${w}px`;
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
