/// <reference lib="dom" />
import type { Anchor } from '@hpe/shared';
import { depthOf, fnv1a, isStableClass, norm, siblingIndex } from './util.js';

export type Fingerprint = Anchor['selectors']['fingerprint'];

const LABEL_ATTRS = ['name', 'placeholder', 'alt', 'aria-label', 'title', 'type', 'src', 'href'];

/**
 * 元素「文字」（空白折疊，最多 256 字元）；只讀取前 2 KB 以免大型容器拖慢。
 * 沒有文字的元素（input、img…）改用辨識性屬性，否則所有同類空元素都會互相冒充。
 */
export function textOf(el: Element): string {
  const t = norm((el.textContent ?? '').slice(0, 2048)).slice(0, 256);
  if (t) return t;
  return norm(
    LABEL_ATTRS.map((a) => el.getAttribute(a) ?? '')
      .join(' ')
      .slice(0, 256),
  );
}

export function fingerprintOf(el: Element, text = textOf(el)): Fingerprint {
  return {
    tag: el.localName,
    classes: Array.from(el.classList)
      .map((c) => c.slice(0, 128))
      .sort()
      .slice(0, 64),
    textHash: fnv1a(text),
    siblingIndex: siblingIndex(el),
    depth: depthOf(el),
  };
}

const bigrams = (s: string): Map<string, number> => {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
};

/** Sørensen–Dice（bigram）。 */
export function dice(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const ga = bigrams(a);
  let inter = 0;
  for (const [g, n] of bigrams(b)) inter += Math.min(n, ga.get(g) ?? 0);
  return (2 * inter) / (a.length - 1 + (b.length - 1));
}

export const WEIGHTS = { tag: 0.1, classes: 0.15, text: 0.45, sibling: 0.15, depth: 0.15 } as const;
const TAG_MISMATCH_FACTOR = 0.6;

const proximity = (a: number, b: number): number => 1 / (1 + Math.abs(a - b));

function classScore(stored: string[], el: Element): number {
  const a = new Set(stored.filter(isStableClass));
  const b = new Set(Array.from(el.classList).filter(isStableClass));
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const c of a) if (b.has(c)) inter++;
  return inter / (a.size + b.size - inter);
}

/** 不含文字的分數上限（tag、class、位置）；用於全文件掃描時提早剪枝。 */
export function structuralScore(fp: Fingerprint, el: Element): number {
  const s =
    WEIGHTS.tag +
    WEIGHTS.classes * classScore(fp.classes, el) +
    WEIGHTS.sibling * proximity(fp.siblingIndex, siblingIndex(el)) +
    WEIGHTS.depth * proximity(fp.depth, depthOf(el));
  return el.localName === fp.tag ? s : s - WEIGHTS.tag;
}

/**
 * 候選元素與儲存的 fingerprint 的相似度（0–1）。
 * 文字佔比最高：雜湊相同 = 1，否則用 snapshot 前 120 字做 Dice 並打 9 折（文字被改過就不可能得滿分）。
 */
export function scoreFingerprint(
  fp: Fingerprint,
  snapshotText: string,
  el: Element,
  text = textOf(el),
): number {
  const struct = structuralScore(fp, el);
  let t: number;
  if (fnv1a(text) === fp.textHash) t = 1;
  else if (!snapshotText && !text) t = 1;
  else if (!snapshotText || !text) t = 0;
  else t = 0.9 * dice(snapshotText.toLowerCase(), text.slice(0, 120).toLowerCase());
  const total = struct + WEIGHTS.text * t;
  return el.localName === fp.tag ? total : total * TAG_MISMATCH_FACTOR;
}
