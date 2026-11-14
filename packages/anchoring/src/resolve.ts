/// <reference lib="dom" />
import type { Anchor, AnchorStatus, Rect } from '@hpe/shared';
import { WEIGHTS, scoreFingerprint, structuralScore, textOf } from './fingerprint.js';
import { buildTextIndex, findQuote, rangeFromIndex, type TextIndex } from './textQuote.js';
import { defaultMeasure, elementOf, norm, safeQueryAll } from './util.js';
import { evalXPath } from './xpath.js';
import { lastClientRect } from './describe.js';

export interface ResolveOptions {
  measure?: (el: Element) => Rect | null;
  /** 取得 Range 最後一個 client rect；預設用 getClientRects。 */
  measureRange?: (range: Range) => Rect | null;
  /** 目前 viewport 尺寸；用來把 fallback 座標依寬度比例換算。 */
  viewportSize?: { w: number; h: number };
  /** 文件尺寸（CSS px）；預設讀 documentElement.scrollWidth/Height，為 0（無 layout）時視為未知。 */
  docSize?: { w: number; h: number };
  /** 元素是否可見；預設：bbox 不為 0、無 `hidden`、不在未開啟的 `<dialog>`、display 不是 none。 */
  isVisible?: (el: Element, rect: Rect | null) => boolean;
  /** 同一批 resolve 共用的整份文件文字索引（可傳函式讓它延後建立）。 */
  textIndex?: TextIndex | (() => TextIndex);
}

export interface ResolveResult {
  status: AnchorStatus;
  confidence: number;
  element: Element | null;
  /** element 的 bbox（frame viewport 座標）；fallback 時為換算後的座標；hidden／orphaned 為 null。 */
  rect: Rect | null;
  /** text 錨點命中的文字範圍 */
  range?: Range | null;
}

const EXACT_MIN = 0.9;
const FUZZY_MIN = 0.6;
const FUZZY_MAX = 0.89;
const FALLBACK_CONFIDENCE = 0.2;
const MAX_SCAN = 3000;

export function defaultIsVisible(el: Element, rect: Rect | null): boolean {
  if (!rect || rect.w <= 0 || rect.h <= 0) return false;
  const win = el.ownerDocument.defaultView;
  for (let n: Element | null = el; n; n = n.parentElement) {
    const h = n.getAttribute('hidden');
    if (h !== null && h !== 'until-found') return false;
    if (n.localName === 'dialog' && !n.hasAttribute('open')) return false;
    if (win && win.getComputedStyle(n).display === 'none') return false;
  }
  return true;
}

/** 目前文件座標系換算後的 fallback 矩形；座標超出文件或沒有資訊時 orphaned。 */
export function fallbackResult(
  anchor: Anchor,
  doc: Document,
  opts: ResolveOptions = {},
): ResolveResult {
  const fb = anchor.fallback;
  const orphan: ResolveResult = { status: 'orphaned', confidence: 0, element: null, rect: null };
  if (![fb.x, fb.y, fb.w, fb.h].every(Number.isFinite)) return orphan;
  const win = doc.defaultView;
  const scale =
    opts.viewportSize && anchor.viewport.width > 0
      ? opts.viewportSize.w / anchor.viewport.width
      : 1;
  const x = fb.x * scale;
  const w = fb.w * scale;
  const docEl = doc.documentElement;
  const size = opts.docSize ?? {
    w: Math.max(docEl?.scrollWidth ?? 0, doc.body?.scrollWidth ?? 0),
    h: Math.max(docEl?.scrollHeight ?? 0, doc.body?.scrollHeight ?? 0),
  };
  if (size.w > 0 && size.h > 0 && (x > size.w || fb.y > size.h || x + w < 0 || fb.y + fb.h < 0))
    return orphan;
  return {
    status: 'fallback',
    confidence: FALLBACK_CONFIDENCE,
    element: null,
    rect: { x: x - (win?.scrollX ?? 0), y: fb.y - (win?.scrollY ?? 0), w, h: fb.h },
  };
}

const ATTR_NAME = /^[A-Za-z_][\w:.-]*$/;

interface Cand {
  score: number;
  sel: boolean;
  explicit: boolean;
}

function resolveInner(anchor: Anchor, doc: Document, opts: ResolveOptions): ResolveResult {
  const measure = opts.measure ?? defaultMeasure;
  const isVisible = opts.isVisible ?? defaultIsVisible;
  const s = anchor.selectors;
  const fp = s.fingerprint;
  const snap = norm(anchor.snapshot.text);
  const texts = new Map<Element, string>();
  const cands = new Map<Element, Cand>();
  let index: TextIndex | undefined;
  const getIndex = () =>
    (index ??=
      typeof opts.textIndex === 'function'
        ? opts.textIndex()
        : (opts.textIndex ?? buildTextIndex(doc.body ?? doc.documentElement)));

  const consider = (el: Element, sel: boolean, explicit = false) => {
    let c = cands.get(el);
    if (!c) {
      let t = texts.get(el);
      if (t === undefined) texts.set(el, (t = textOf(el)));
      c = { score: scoreFingerprint(fp, snap, el, t), sel: false, explicit: false };
      cands.set(el, c);
    }
    c.sel ||= sel;
    c.explicit ||= explicit;
  };
  const best = (): [Element, Cand] | null => {
    let b: [Element, Cand] | null = null;
    for (const e of cands)
      if (!b || e[1].score > b[1].score || (e[1].score === b[1].score && e[1].sel && !b[1].sel))
        b = e;
    return b;
  };
  const settled = (): [Element, Cand] | null => {
    let b: [Element, Cand] | null = null;
    for (const e of cands) {
      if (e[1].sel && (e[1].explicit || e[1].score >= EXACT_MIN) && (!b || e[1].score > b[1].score))
        b = e;
    }
    return b;
  };

  // 1–3：dataAttr → css → xpath
  const da = s.dataAttr;
  if (da) {
    let els: Element[] = [];
    if (da.name === 'id') {
      const e = doc.getElementById(da.value);
      els = e ? [e] : [];
    } else if (ATTR_NAME.test(da.name)) {
      els = safeQueryAll(
        doc,
        `[${da.name}="${da.value.replace(/["\\]/g, '\\$&').replace(/[\n\r\f]/g, ' ')}"]`,
        20,
      );
    }
    for (const e of els) consider(e, true, els.length === 1 && da.name === 'data-comment-anchor');
  }
  if (!settled() && s.css) for (const e of safeQueryAll(doc, s.css, 20)) consider(e, true);
  if (!settled() && s.xpath) {
    const e = evalXPath(doc, s.xpath);
    if (e) consider(e, true);
  }

  // 4：textQuote（模糊比對）
  if (!settled() && s.textQuote) {
    const idx = getIndex();
    for (const m of findQuote(idx, s.textQuote, 3)) {
      let el = idx.nodes[idx.node[m.start] ?? -1]?.parentElement ?? null;
      for (let i = 0; el && i < 5; i++, el = el.parentElement) consider(el, false);
    }
  }

  // 5：fingerprint 全文件掃描
  const top = settled() ?? best();
  if (fp.tag && (!top || top[1].score < EXACT_MIN)) {
    const threshold = Math.max(FUZZY_MIN, top?.[1].score ?? 0);
    const list = doc.getElementsByTagName(fp.tag);
    for (let i = 0; i < list.length && i < MAX_SCAN; i++) {
      const el = list[i];
      if (el && !cands.has(el) && structuralScore(fp, el) + WEIGHTS.text >= threshold)
        consider(el, false);
    }
  }

  const chosen = settled() ?? best();
  if (!chosen || (chosen[1].score < FUZZY_MIN && !chosen[1].explicit))
    return fallbackResult(anchor, doc, opts);
  const cand = chosen[1];
  let element = chosen[0];
  let exact = cand.sel && (cand.explicit || cand.score >= EXACT_MIN);
  let confidence = exact
    ? Math.max(cand.score, cand.explicit ? EXACT_MIN : 0)
    : Math.min(cand.score, FUZZY_MAX);

  // text 錨點：定位選取文字；找不到就降級
  let range: Range | null = null;
  if (anchor.kind === 'text' && s.textQuote) {
    const local = buildTextIndex(element);
    const m = findQuote(local, s.textQuote, 1)[0];
    if (m) range = rangeFromIndex(local, doc, m.start, m.end);
    if (!range) {
      const g = findQuote(getIndex(), s.textQuote, 1)[0];
      const moved = g && !g.fuzzy ? rangeFromIndex(getIndex(), doc, g.start, g.end) : null;
      if (moved) {
        range = moved;
        element = elementOf(moved.commonAncestorContainer) ?? element;
        exact = false;
        confidence = Math.min(confidence, FUZZY_MAX);
      } else {
        exact = false;
        confidence = Math.min(confidence, 0.69);
      }
    }
    if (confidence < FUZZY_MIN) return fallbackResult(anchor, doc, opts);
  }

  const rect = measure(element);
  if (!isVisible(element, rect))
    return { status: 'hidden', confidence, element, rect: null, range };
  return { status: exact ? 'exact' : 'fuzzy', confidence, element, rect, range };
}

/**
 * 依序嘗試 dataAttr → css → xpath → textQuote → fingerprint 掃描 → fallback 座標。
 * 不會丟例外：壞掉的 selector、惡意文件都只會讓結果往 fallback／orphaned 退。
 */
export function resolve(anchor: Anchor, doc: Document, opts: ResolveOptions = {}): ResolveResult {
  try {
    return resolveInner(anchor, doc, opts);
  } catch {
    try {
      return fallbackResult(anchor, doc, opts);
    } catch {
      return { status: 'orphaned', confidence: 0, element: null, rect: null };
    }
  }
}

/**
 * parent 用來放 pin 的矩形（frame viewport 座標）：
 * element = 元素 bbox（pin 再套 elementOffset）；region = bbox 內的區域框；
 * text = 命中文字範圍的最後一個 client rect；fallback = 換算後的座標；hidden／orphaned = null。
 */
export function rectForAnchor(
  anchor: Anchor,
  result: ResolveResult,
  doc: Document,
  opts: ResolveOptions = {},
): Rect | null {
  if (result.status === 'orphaned' || result.status === 'hidden') return null;
  if (result.status === 'fallback') return fallbackResult(anchor, doc, opts).rect;
  const bbox =
    result.rect ?? (result.element ? (opts.measure ?? defaultMeasure)(result.element) : null);
  if (!bbox) return null;
  const sel = anchor.selectors;
  if (anchor.kind === 'region' && sel.regionSize) {
    return {
      x: bbox.x + sel.elementOffset.x * bbox.w,
      y: bbox.y + sel.elementOffset.y * bbox.h,
      w: sel.regionSize.w * bbox.w,
      h: sel.regionSize.h * bbox.h,
    };
  }
  if (anchor.kind === 'text' && result.range && !result.range.collapsed) {
    return (opts.measureRange ?? lastClientRect)(result.range) ?? bbox;
  }
  return bbox;
}
