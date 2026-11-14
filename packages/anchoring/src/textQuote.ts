/// <reference lib="dom" />
import type { Anchor } from '@hpe/shared';
import { norm } from './util.js';

type TextQuote = NonNullable<Anchor['selectors']['textQuote']>;

const MAX_INDEX_CHARS = 400_000;
const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template']);

/** 把 root 底下的文字節點串成一個「空白折疊」字串，並記錄每個字元對應的 DOM 位置。 */
export interface TextIndex {
  text: string;
  nodes: Text[];
  /** 每個字元所屬的 nodes 索引 */
  node: number[];
  /** 每個字元在該文字節點內的 offset */
  off: number[];
}

export function buildTextIndex(root: Node): TextIndex {
  const doc = root.ownerDocument ?? (root as Document);
  const idx: TextIndex = { text: '', nodes: [], node: [], off: [] };
  const out: string[] = [];
  let lastSpace = true;
  const walker = doc.createTreeWalker(root, 0x1 | 0x4, {
    acceptNode: (n) =>
      n.nodeType === 1 && SKIP_TAGS.has((n as Element).localName) ? 2 /* REJECT */ : 1,
  });
  for (let n = walker.nextNode(); n && out.length < MAX_INDEX_CHARS; n = walker.nextNode()) {
    if (n.nodeType !== 3) continue;
    const data = (n as Text).data;
    const k = idx.nodes.length;
    idx.nodes.push(n as Text);
    for (let i = 0; i < data.length; i++) {
      const space = /\s/.test(data.charAt(i));
      if (space && lastSpace) continue;
      lastSpace = space;
      out.push(space ? ' ' : data.charAt(i));
      idx.node.push(k);
      idx.off.push(i);
    }
  }
  idx.text = out.join('');
  return idx;
}

/** 在 index 位置 [start, end) 建立 Range。 */
export function rangeFromIndex(
  idx: TextIndex,
  doc: Document,
  start: number,
  end: number,
): Range | null {
  const sn = idx.nodes[idx.node[start] ?? -1];
  const en = idx.nodes[idx.node[end - 1] ?? -1];
  if (!sn || !en) return null;
  try {
    const r = doc.createRange();
    r.setStart(sn, idx.off[start] ?? 0);
    r.setEnd(en, (idx.off[end - 1] ?? 0) + 1);
    return r;
  } catch {
    return null;
  }
}

/** 取得 Range 前後文（空白折疊、不 trim），用於 prefix/suffix。 */
export function contextAround(root: Node, range: Range): { prefix: string; suffix: string } {
  const doc = root.ownerDocument ?? (root as Document);
  const collapse = (s: string) => s.replace(/\s+/g, ' ');
  try {
    const pre = doc.createRange();
    pre.setStart(root, 0);
    pre.setEnd(range.startContainer, range.startOffset);
    const post = doc.createRange();
    post.setStart(range.endContainer, range.endOffset);
    post.setEnd(root, root.childNodes.length);
    return {
      prefix: collapse(pre.toString()).slice(-32),
      suffix: collapse(post.toString()).slice(0, 32),
    };
  } catch {
    return { prefix: '', suffix: '' };
  }
}

export function makeQuote(text: string, prefix: string, suffix: string): TextQuote | undefined {
  const exact = norm(text);
  if (!exact) return undefined;
  const clipped = exact.slice(0, 256);
  return {
    exact: clipped,
    prefix: prefix.slice(-32),
    suffix: exact.length > 256 ? exact.slice(256, 288) : suffix.slice(0, 32),
  };
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (cur[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + (a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length] ?? 0;
}

export const similarity = (a: string, b: string): number => {
  const m = Math.max(a.length, b.length);
  return m === 0 ? 1 : 1 - levenshtein(a, b) / m;
};

/** Bitap（shift-and，容許 k 個編輯）：回傳每個結尾位置的最小編輯數；pattern ≤ 30 字元。 */
function bitap(text: string, pat: string, k: number): { end: number; err: number }[] {
  const m = pat.length;
  const mask = new Map<number, number>();
  for (let i = 0; i < m; i++)
    mask.set(pat.charCodeAt(i), (mask.get(pat.charCodeAt(i)) ?? 0) | (1 << i));
  const R = Array.from({ length: k + 1 }, (_, d) => (1 << d) - 1);
  const hit = 1 << (m - 1);
  const out: { end: number; err: number }[] = [];
  for (let j = 0; j < text.length; j++) {
    const cm = mask.get(text.charCodeAt(j)) ?? 0;
    let oldPrev = R[0] ?? 0;
    R[0] = (((oldPrev << 1) | 1) & cm) >>> 0;
    let newPrev = R[0];
    for (let d = 1; d <= k; d++) {
      const old = R[d] ?? 0;
      R[d] = ((((old << 1) | 1) & cm) | (((oldPrev | newPrev) << 1) | 1) | oldPrev) >>> 0;
      oldPrev = old;
      newPrev = R[d] ?? 0;
    }
    for (let d = 0; d <= k; d++) {
      if ((R[d] ?? 0) & hit) {
        out.push({ end: j + 1, err: d });
        break;
      }
    }
  }
  return out;
}

const commonSuffix = (a: string, b: string): number => {
  let n = 0;
  while (n < a.length && n < b.length && a.charAt(a.length - 1 - n) === b.charAt(b.length - 1 - n))
    n++;
  return n;
};
const commonPrefix = (a: string, b: string): number => {
  let n = 0;
  while (n < a.length && n < b.length && a.charAt(n) === b.charAt(n)) n++;
  return n;
};

/** prefix/suffix 與文字實際前後文的吻合度（0–1）；沒有前後文資訊時為 1。 */
function contextScore(text: string, start: number, end: number, q: TextQuote): number {
  const pre = q.prefix.trimEnd();
  const suf = q.suffix.trimStart();
  const before = text.slice(Math.max(0, start - 40), start).trimEnd();
  const after = text.slice(end, end + 40).trimStart();
  const parts: number[] = [];
  if (pre) parts.push(Math.min(1, commonSuffix(pre, before) / pre.length));
  if (suf) parts.push(Math.min(1, commonPrefix(suf, after) / suf.length));
  return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 1;
}

export interface QuoteMatch {
  start: number;
  end: number;
  /** 0–1：exact 命中 ≥ 0.7；模糊命中 = 相似度與前後文的加權 */
  score: number;
  fuzzy: boolean;
}

const MAX_OCCURRENCES = 100;
const MAX_FUZZY_CANDIDATES = 6;

/**
 * 在 index 中尋找 textQuote：先找精確子字串（以前後文挑最像的），找不到再用 bitap 模糊比對，
 * 候選再用 Levenshtein 相似度驗證（≥ 0.6）。回傳依分數由高到低排序的匹配。
 */
export function findQuote(idx: TextIndex, q: TextQuote, max = 5): QuoteMatch[] {
  const exact = norm(q.exact);
  const text = idx.text;
  if (!exact) return [];
  const found: QuoteMatch[] = [];
  for (
    let at = text.indexOf(exact), n = 0;
    at !== -1 && n < MAX_OCCURRENCES;
    at = text.indexOf(exact, at + 1), n++
  ) {
    found.push({
      start: at,
      end: at + exact.length,
      score: 0.7 + 0.3 * contextScore(text, at, at + exact.length, q),
      fuzzy: false,
    });
  }
  if (found.length === 0) {
    const pat = exact.slice(0, 30);
    const k = Math.min(7, Math.max(1, Math.floor(pat.length / 4)));
    const hits = bitap(text, pat, k).sort((a, b) => a.err - b.err || a.end - b.end);
    const taken: number[] = [];
    for (const h of hits) {
      if (found.length >= MAX_FUZZY_CANDIDATES) break;
      if (taken.some((t) => Math.abs(t - h.end) < pat.length)) continue;
      taken.push(h.end);
      const start = Math.max(0, h.end - pat.length);
      const win = text.slice(start, start + exact.length + k);
      const sim = Math.max(
        similarity(win.slice(0, exact.length), exact),
        similarity(win.slice(0, exact.length - 1), exact),
        similarity(win.slice(0, exact.length + 1), exact),
      );
      if (sim < 0.6) continue;
      const end = Math.min(text.length, start + exact.length);
      found.push({
        start,
        end,
        score: Math.min(0.69, 0.8 * sim + 0.2 * contextScore(text, start, end, q)),
        fuzzy: true,
      });
    }
  }
  return found.sort((a, b) => b.score - a.score).slice(0, max);
}
