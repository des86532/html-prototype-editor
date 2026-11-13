import { MESSAGE_LIMITS, PROTOCOL_VERSION, type Anchor, type Rect } from '@hpe/shared';
import {
  buildTextIndex,
  defaultMeasure,
  lastClientRect,
  rectForAnchor,
  resolve,
  type ResolveOptions,
  type ResolveResult,
  type TextIndex,
} from '@hpe/anchoring';
import type { AgentBridge, AgentModule } from './bridge-types.js';

export interface GeometryOptions {
  /** 量測元素 bbox（frame viewport 座標）；測試用，預設 getBoundingClientRect。 */
  measure?: (el: Element) => Rect | null;
  measureRange?: (range: Range) => Rect | null;
  isVisible?: ResolveOptions['isVisible'];
  /** 排程下一個 frame；預設 requestAnimationFrame。 */
  raf?: (cb: () => void) => number;
  cancelRaf?: (id: number) => void;
  now?: () => number;
}

interface Entry {
  anchor: Anchor;
  result: ResolveResult;
}

/** 非 exact 的 entry 在 DOM 變動後重新 resolve 的最短間隔，避免動畫期間每個 frame 都全量重算。 */
const RE_RESOLVE_INTERVAL_MS = 250;
const MAX_ENTRIES = 2000;
const EPS = 0.01;

const sameRect = (a: Rect | null | undefined, b: Rect | null | undefined): boolean =>
  !a || !b
    ? !a && !b
    : Math.abs(a.x - b.x) < EPS &&
      Math.abs(a.y - b.y) < EPS &&
      Math.abs(a.w - b.w) < EPS &&
      Math.abs(a.h - b.h) < EPS;

/**
 * 處理 resolveAnchors／trackAnchors／scrollToAnchor。
 * 被追蹤的討論串會記住 resolve 到的元素（或文字 Range），在 resize／DOM 變動／捲動（capture，含內部捲動容器）
 * 時以 rAF 節流重新量測，送出 viewport 座標系的 `geometry`；每個 frame 只做 O(追蹤數) 次量測，不重新 resolve。
 */
export function createGeometry(options: GeometryOptions = {}): AgentModule {
  return (bridge: AgentBridge) => {
    const measure = options.measure ?? defaultMeasure;
    const measureRange = options.measureRange ?? lastClientRect;
    const schedule = options.raf ?? ((cb) => requestAnimationFrame(cb));
    const cancel = options.cancelRaf ?? ((id) => cancelAnimationFrame(id));
    const now = options.now ?? (() => Date.now());
    const base: ResolveOptions = {
      measure,
      measureRange,
      isVisible: options.isVisible,
      viewportSize: undefined,
    };
    const ropts = (): ResolveOptions => ({
      ...base,
      viewportSize: { w: window.innerWidth, h: window.innerHeight },
    });

    const entries = new Map<string, Entry>();
    let tracked: string[] = [];
    let sent = new Map<string, Rect | null>();
    let frame: number | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let domDirty = false;
    let lastReResolve = -Infinity;
    let observers: (() => void) | null = null;

    const rectFor = (e: Entry): Rect | null => {
      const { result } = e;
      if (result.status === 'orphaned') return null;
      if (result.status === 'fallback') return rectForAnchor(e.anchor, result, document, ropts());
      const el = result.element;
      if (!el || !el.isConnected) return null;
      const bbox = measure(el);
      if (!bbox || bbox.w <= 0 || bbox.h <= 0 || result.status === 'hidden') return null;
      return rectForAnchor(e.anchor, { ...result, rect: bbox }, document, ropts());
    };

    const reResolve = () => {
      lastReResolve = now();
      let index: TextIndex | undefined;
      const textIndex = () => (index ??= buildTextIndex(document.body ?? document.documentElement));
      for (const id of tracked) {
        const e = entries.get(id);
        if (!e) continue;
        const r = e.result;
        const stale = r.status !== 'exact' || !r.element || !r.element.isConnected;
        if (stale) e.result = resolve(e.anchor, document, { ...ropts(), textIndex });
      }
    };

    const flush = (force: boolean) => {
      if (domDirty && now() - lastReResolve >= RE_RESOLVE_INTERVAL_MS) {
        domDirty = false;
        reResolve();
      } else if (domDirty && timer === null) {
        timer = setTimeout(() => {
          timer = null;
          request();
        }, RE_RESOLVE_INTERVAL_MS);
      }
      const rects: Record<string, Rect | null> = {};
      const next = new Map<string, Rect | null>();
      let changed = force || tracked.length !== sent.size;
      for (const id of tracked.slice(0, MESSAGE_LIMITS.maxRects)) {
        const entry = entries.get(id);
        const rect = entry ? rectFor(entry) : null;
        rects[id] = rect;
        next.set(id, rect);
        if (!changed && !sameRect(rect, sent.get(id))) changed = true;
      }
      if (!changed) return;
      sent = next;
      bridge.send({
        v: PROTOCOL_VERSION,
        type: 'geometry',
        viewport: { w: window.innerWidth, h: window.innerHeight },
        rects,
      });
    };

    const request = () => {
      if (frame !== null) return;
      frame = schedule(() => {
        frame = null;
        flush(false);
      });
    };
    const onScrollOrResize = () => request();
    const onDomChange = () => {
      domDirty = true;
      request();
    };

    const observe = () => {
      if (observers) return;
      const opts = { capture: true, passive: true } as const;
      const events = ['scroll', 'resize', 'load', 'transitionend', 'animationend'] as const;
      for (const t of events) window.addEventListener(t, onScrollOrResize, opts);
      const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(onScrollOrResize) : null;
      ro?.observe(document.documentElement);
      const mo = typeof MutationObserver === 'function' ? new MutationObserver(onDomChange) : null;
      mo?.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
      observers = () => {
        for (const t of events) window.removeEventListener(t, onScrollOrResize, opts);
        ro?.disconnect();
        mo?.disconnect();
      };
    };

    const unsubscribe = bridge.subscribe((msg) => {
      if (msg.type === 'resolveAnchors') {
        let index: TextIndex | undefined;
        const textIndex = () =>
          (index ??= buildTextIndex(document.body ?? document.documentElement));
        const results = msg.anchors.map(({ threadId, anchor }) => {
          const result = resolve(anchor, document, { ...ropts(), textIndex });
          if (entries.size >= MAX_ENTRIES && !entries.has(threadId)) {
            for (const k of entries.keys()) if (!tracked.includes(k)) entries.delete(k);
          }
          entries.set(threadId, { anchor, result });
          return {
            threadId,
            status: result.status,
            confidence: result.confidence,
            rect: rectForAnchor(anchor, result, document, ropts()),
          };
        });
        bridge.send({
          v: PROTOCOL_VERSION,
          type: 'anchorsResolved',
          requestId: msg.requestId,
          results,
        });
        if (tracked.some((id) => msg.anchors.some((a) => a.threadId === id))) flush(true);
      } else if (msg.type === 'trackAnchors') {
        tracked = Array.from(new Set(msg.threadIds));
        sent = new Map();
        if (tracked.length) observe();
        flush(true);
      } else if (msg.type === 'scrollToAnchor') {
        const entry = entries.get(msg.threadId);
        if (!entry) return;
        const { result, anchor } = entry;
        const el = result.range?.startContainer.parentElement ?? result.element;
        if (el?.isConnected && typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        } else if (result.status === 'fallback' && typeof window.scrollTo === 'function') {
          window.scrollTo({
            left: Math.max(0, anchor.fallback.x - window.innerWidth / 2),
            top: Math.max(0, anchor.fallback.y - window.innerHeight / 2),
            behavior: 'smooth',
          });
        }
        flush(true);
      }
    });

    return () => {
      unsubscribe();
      observers?.();
      observers = null;
      if (frame !== null) cancel(frame);
      if (timer !== null) clearTimeout(timer);
      frame = null;
      timer = null;
    };
  };
}

export const installGeometry: AgentModule = createGeometry();
