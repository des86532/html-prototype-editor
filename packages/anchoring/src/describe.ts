/// <reference lib="dom" />
import { MESSAGE_LIMITS, type Anchor, type Rect } from '@hpe/shared';
import { cssPath } from './cssPath.js';
import { fingerprintOf, textOf } from './fingerprint.js';
import { contextAround, makeQuote } from './textQuote.js';
import { clamp01, defaultMeasure, elementOf, isStableId, norm } from './util.js';
import { xpathOf } from './xpath.js';

export interface DescribeInput {
  element: Element;
  kind: 'element' | 'region' | 'text';
  pageId: string;
  viewport: { width: number; height: number; dpr: number; preset?: string };
  /** 點擊位置（frame viewport 座標），kind 'element' 用。 */
  point?: { x: number; y: number };
  /** 拖曳出的區域（viewport 座標），kind 'region' 用；element 為其最近共同祖先。 */
  region?: Rect;
  /** 選取範圍，kind 'text' 用。 */
  range?: Range;
  measure?: (el: Element) => Rect | null;
  /** 取得 Range 最後一個 client rect；預設用 getClientRects。 */
  measureRange?: (range: Range) => Rect | null;
  /** 文件捲動量；預設取自 window。 */
  scroll?: { x: number; y: number };
}

export function lastClientRect(range: Range): Rect | null {
  const list = typeof range.getClientRects === 'function' ? range.getClientRects() : null;
  const r = list && list.length ? list[list.length - 1] : null;
  return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
}

function dataAttrOf(el: Element): Anchor['selectors']['dataAttr'] {
  for (const name of ['data-comment-anchor', 'data-testid']) {
    const v = el.getAttribute(name);
    if (v && v.length <= 256) return { name, value: v };
  }
  const id = el.getAttribute('id');
  if (id && isStableId(id) && el.ownerDocument.querySelectorAll(`#${id}`).length === 1) {
    return { name: 'id', value: id };
  }
  return undefined;
}

function stateHintOf(el: Element): Anchor['stateHint'] {
  const hash = el.ownerDocument.defaultView?.location.hash ?? '';
  const inDialog = !!el.closest('dialog[open], [aria-modal="true"]');
  if (!hash && !inDialog) return undefined;
  return {
    ...(hash ? { hash: hash.slice(0, 512) } : {}),
    ...(inDialog ? { inDialog: true } : {}),
  };
}

/**
 * 依穩定度由高到低收集 selector，並記錄 fingerprint、元素內相對位置、文件座標 fallback、
 * stateHint 與 snapshot。回傳的 `rect` 與 pick 訊息一致（frame viewport 座標）：
 * element = 元素 bbox、region = 拖曳區域、text = 選取範圍最後一個 client rect。
 */
export function describe(input: DescribeInput): { anchor: Anchor; rect: Rect } {
  const { element, kind } = input;
  const doc = element.ownerDocument;
  const win = doc.defaultView;
  const measure = input.measure ?? defaultMeasure;
  const bbox = measure(element) ?? { x: 0, y: 0, w: 0, h: 0 };
  const scroll = input.scroll ?? { x: win?.scrollX ?? 0, y: win?.scrollY ?? 0 };
  const rel = (x: number, y: number) => ({
    x: bbox.w > 0 ? clamp01((x - bbox.x) / bbox.w) : 0.5,
    y: bbox.h > 0 ? clamp01((y - bbox.y) / bbox.h) : 0.5,
  });

  let rect = bbox;
  let elementOffset = { x: 0.5, y: 0.5 };
  let regionSize: { w: number; h: number } | undefined;
  let quote: Anchor['selectors']['textQuote'];
  const root = doc.body ?? doc.documentElement;

  if (kind === 'region' && input.region) {
    rect = input.region;
    elementOffset = rel(rect.x, rect.y);
    regionSize = {
      w: bbox.w > 0 ? clamp01(rect.w / bbox.w) : 1,
      h: bbox.h > 0 ? clamp01(rect.h / bbox.h) : 1,
    };
  } else if (kind === 'text' && input.range) {
    rect = (input.measureRange ?? lastClientRect)(input.range) ?? bbox;
    elementOffset = rel(rect.x + rect.w, rect.y);
    const ctx = contextAround(root, input.range);
    quote = makeQuote(input.range.toString(), ctx.prefix, ctx.suffix);
  } else if (input.point) {
    elementOffset = rel(input.point.x, input.point.y);
  }

  const text = textOf(element);
  if (!quote && kind !== 'text' && element.textContent?.trim()) {
    const r = doc.createRange();
    try {
      r.selectNodeContents(element);
      const ctx = contextAround(root, r);
      quote = makeQuote(text, ctx.prefix, ctx.suffix);
    } catch {
      quote = makeQuote(text, '', '');
    }
  }

  const dataAttr = dataAttrOf(element);
  const stateHint = stateHintOf(element);
  const css = cssPath(element);
  const xpath = xpathOf(element);
  const anchor: Anchor = {
    pageId: input.pageId,
    kind,
    viewport: input.viewport,
    selectors: {
      ...(dataAttr ? { dataAttr } : {}),
      ...(css ? { css } : {}),
      ...(xpath ? { xpath } : {}),
      ...(quote ? { textQuote: quote } : {}),
      fingerprint: fingerprintOf(element, text),
      elementOffset,
      ...(regionSize ? { regionSize } : {}),
    },
    fallback: { x: rect.x + scroll.x, y: rect.y + scroll.y, w: rect.w, h: rect.h },
    ...(stateHint ? { stateHint } : {}),
    snapshot: {
      tag: element.localName.slice(0, 64),
      text: norm(text).slice(0, MESSAGE_LIMITS.maxSnapshotTextLength),
    },
  };
  return { anchor, rect };
}

/** Range 所屬的最近 element（text 錨點的容器）。 */
export const containerOf = (range: Range): Element | null =>
  elementOf(range.commonAncestorContainer);
