// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { describe as describeAnchor } from '@hpe/anchoring';
import type { Anchor, FrameToParent, Rect } from '@hpe/shared';
import { createGeometry } from './geometry.js';
import { fakeBridge, fakeRaf, setBody } from './testBridge.js';

const raf = fakeRaf();
const rects = new Map<Element, Rect>();
const measure = (el: Element) => rects.get(el) ?? null;
const disposers: (() => void)[] = [];
let clock = 0;

function setup() {
  const fb = fakeBridge();
  disposers.push(
    createGeometry({
      measure,
      raf: raf.raf,
      cancelRaf: raf.cancelRaf,
      now: () => clock,
      isVisible: (_e, r) => !!r && r.w > 0,
    })(fb.bridge),
  );
  return fb;
}
function anchorFor(el: Element, kind: 'element' | 'region' = 'element'): Anchor {
  return describeAnchor({
    element: el,
    kind,
    pageId: 'index.html',
    viewport: { width: 1440, height: 900, dpr: 1 },
    measure,
    point: { x: 0, y: 0 },
  }).anchor;
}
const geoms = (sent: FrameToParent[]) =>
  sent.filter((m) => m.type === 'geometry') as Extract<FrameToParent, { type: 'geometry' }>[];

beforeEach(() => {
  setBody(
    `<main><button id="a" class="x">Alpha</button><button id="b" class="y">Beta</button><p id="c">Gamma text</p></main>`,
  );
  rects.clear();
  rects.set(document.getElementById('a')!, { x: 10, y: 20, w: 100, h: 30 });
  rects.set(document.getElementById('b')!, { x: 10, y: 60, w: 100, h: 30 });
  rects.set(document.getElementById('c')!, { x: 10, y: 100, w: 200, h: 20 });
  clock = 0;
});
afterEach(() => {
  disposers.splice(0).forEach((d) => d());
  vi.restoreAllMocks();
});

describe('geometry', () => {
  it('resolveAnchors replies with status, confidence and rect', () => {
    const { deliver, sent } = setup();
    const a = anchorFor(document.getElementById('a')!);
    const gone = {
      ...a,
      selectors: {
        ...a.selectors,
        css: 'nope',
        xpath: '/html[1]/nope[1]',
        dataAttr: undefined,
        textQuote: undefined,
        fingerprint: { ...a.selectors.fingerprint, tag: 'section', textHash: 'zz' },
      },
      snapshot: { tag: 'section', text: 'zzz' },
    };
    deliver({
      v: 1,
      type: 'resolveAnchors',
      requestId: 'req1',
      anchors: [
        { threadId: 'T1', anchor: a },
        { threadId: 'T2', anchor: gone },
      ],
    });
    expect(sent).toHaveLength(1);
    const msg = sent[0] as Extract<FrameToParent, { type: 'anchorsResolved' }>;
    expect(msg.requestId).toBe('req1');
    expect(msg.results[0]).toMatchObject({
      threadId: 'T1',
      status: 'exact',
      rect: { x: 10, y: 20, w: 100, h: 30 },
    });
    expect(msg.results[1]).toMatchObject({ threadId: 'T2', status: 'fallback' });
  });

  it('trackAnchors emits geometry immediately, then only when rects change (rAF throttled)', () => {
    const { deliver, sent } = setup();
    const els = ['a', 'b'].map((id) => document.getElementById(id)!);
    deliver({
      v: 1,
      type: 'resolveAnchors',
      requestId: 'r',
      anchors: els.map((e, i) => ({ threadId: `T${i}`, anchor: anchorFor(e) })),
    });
    deliver({ v: 1, type: 'trackAnchors', threadIds: ['T0', 'T1', 'TX'] });
    expect(geoms(sent)).toHaveLength(1);
    expect(geoms(sent)[0]!.rects).toEqual({
      T0: { x: 10, y: 20, w: 100, h: 30 },
      T1: { x: 10, y: 60, w: 100, h: 30 },
      TX: null,
    });

    // unchanged scroll → nothing sent
    window.dispatchEvent(new Event('scroll'));
    raf.flush();
    expect(geoms(sent)).toHaveLength(1);

    // scroll storm → one frame, one message
    rects.set(els[0]!, { x: 10, y: -280, w: 100, h: 30 });
    for (let i = 0; i < 20; i++) els[1]!.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('resize'));
    expect(raf.pending()).toBe(1);
    raf.flush();
    expect(geoms(sent)).toHaveLength(2);
    expect(geoms(sent)[1]!.rects.T0).toEqual({ x: 10, y: -280, w: 100, h: 30 });
  });

  it('catches scroll events from inner scroll containers (capture)', () => {
    const { deliver, sent } = setup();
    const a = document.getElementById('a')!;
    deliver({
      v: 1,
      type: 'resolveAnchors',
      requestId: 'r',
      anchors: [{ threadId: 'T0', anchor: anchorFor(a) }],
    });
    deliver({ v: 1, type: 'trackAnchors', threadIds: ['T0'] });
    rects.set(a, { x: 11, y: 20, w: 100, h: 30 });
    document.querySelector('main')!.dispatchEvent(new Event('scroll', { bubbles: false }));
    raf.flush();
    expect(geoms(sent)).toHaveLength(2);
  });

  it('reports null for hidden elements and removed elements fall back on DOM mutation', async () => {
    const { deliver, sent } = setup();
    const b = document.getElementById('b')!;
    const anchor = anchorFor(b);
    deliver({
      v: 1,
      type: 'resolveAnchors',
      requestId: 'r',
      anchors: [{ threadId: 'T1', anchor }],
    });
    deliver({ v: 1, type: 'trackAnchors', threadIds: ['T1'] });
    rects.set(b, { x: 10, y: 60, w: 0, h: 0 });
    window.dispatchEvent(new Event('scroll'));
    raf.flush();
    expect(geoms(sent).at(-1)!.rects.T1).toBeNull();

    rects.set(b, { x: 10, y: 60, w: 100, h: 30 });
    b.remove();
    await Promise.resolve(); // MutationObserver microtask
    raf.flush();
    const last = geoms(sent).at(-1)!.rects.T1;
    // fallback 座標依目前 viewport 寬度 / 建立時寬度換算 x、w
    const k = window.innerWidth / anchor.viewport.width;
    expect(last).toEqual({
      x: anchor.fallback.x * k,
      y: anchor.fallback.y,
      w: anchor.fallback.w * k,
      h: anchor.fallback.h,
    });
  });

  it('region anchors report the region sub-rect', () => {
    const { deliver, sent } = setup();
    const c = document.getElementById('c')!;
    const { anchor } = describeAnchor({
      element: c,
      kind: 'region',
      pageId: 'index.html',
      viewport: { width: 1440, height: 900, dpr: 1 },
      measure,
      region: { x: 20, y: 105, w: 100, h: 10 },
    });
    deliver({ v: 1, type: 'resolveAnchors', requestId: 'r', anchors: [{ threadId: 'R', anchor }] });
    const res = sent[0] as Extract<FrameToParent, { type: 'anchorsResolved' }>;
    expect(res.results[0]!.rect).toEqual({ x: 20, y: 105, w: 100, h: 10 });
  });

  it('scrollToAnchor scrolls the element into view and forces a fresh geometry', () => {
    const { deliver, sent } = setup();
    const b = document.getElementById('b')!;
    const scrollIntoView = vi.fn();
    b.scrollIntoView = scrollIntoView;
    deliver({
      v: 1,
      type: 'resolveAnchors',
      requestId: 'r',
      anchors: [{ threadId: 'T1', anchor: anchorFor(b) }],
    });
    deliver({ v: 1, type: 'trackAnchors', threadIds: ['T1'] });
    const before = geoms(sent).length;
    deliver({ v: 1, type: 'scrollToAnchor', threadId: 'T1' });
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'center',
      inline: 'center',
    });
    expect(geoms(sent).length).toBe(before + 1);
    deliver({ v: 1, type: 'scrollToAnchor', threadId: 'unknown' });
    expect(geoms(sent).length).toBe(before + 1);
  });

  it('dispose removes listeners, observers and the subscription', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const fb = fakeBridge();
    const dispose = createGeometry({ measure, raf: raf.raf, cancelRaf: raf.cancelRaf })(fb.bridge);
    fb.deliver({ v: 1, type: 'trackAnchors', threadIds: ['T'] });
    expect(add.mock.calls.length).toBeGreaterThan(0);
    dispose();
    expect(remove.mock.calls.length).toBe(add.mock.calls.length);
    expect(fb.subs.size).toBe(0);
    const n = fb.sent.length;
    window.dispatchEvent(new Event('scroll'));
    raf.flush();
    expect(fb.sent.length).toBe(n);
  });
});

describe('geometry perf (jsdom, injected measure)', () => {
  /**
   * 這只量「per-frame 的 JS 計算 + 序列化」部分：200 個被追蹤的 anchor 在一次 scroll tick 內重新量測、
   * 比對、組出 geometry 訊息。真實 layout／paint 的成本要由 Playwright 的 Performance trace
   * （規格 Verification §3：200 pins < 16 ms）量測，jsdom 沒有 layout。
   */
  it('recomputes 200 tracked anchors in < 16 ms per scroll tick', () => {
    setBody(
      `<main>${Array.from({ length: 200 }, (_, i) => `<div class="row"><button class="b${i}" id="n${i}">Item ${i}</button></div>`).join('')}</main>`,
    );
    const els = Array.from(document.querySelectorAll('button'));
    let offset = 0;
    const idx = new Map(els.map((e, i) => [e, i]));
    const fastMeasure = (el: Element) => {
      const i = idx.get(el as HTMLButtonElement);
      return i === undefined
        ? { x: 0, y: 0, w: 800, h: 20000 }
        : { x: 10, y: i * 40 + offset, w: 100, h: 30 };
    };
    const fb = fakeBridge();
    const r = fakeRaf();
    const dispose = createGeometry({ measure: fastMeasure, raf: r.raf, cancelRaf: r.cancelRaf })(
      fb.bridge,
    );
    const anchors = els.map((el, i) => ({
      threadId: `T${i}`,
      anchor: describeAnchor({
        element: el,
        kind: 'element',
        pageId: 'p',
        viewport: { width: 1440, height: 900, dpr: 1 },
        measure: fastMeasure,
      }).anchor,
    }));
    fb.deliver({ v: 1, type: 'resolveAnchors', requestId: 'r', anchors });
    fb.deliver({ v: 1, type: 'trackAnchors', threadIds: anchors.map((a) => a.threadId) });
    const samples: number[] = [];
    for (let k = 0; k < 15; k++) {
      offset -= 5;
      const t0 = performance.now();
      window.dispatchEvent(new Event('scroll'));
      r.flush();
      samples.push(performance.now() - t0);
    }
    dispose();
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)]!;
    expect(fb.sent.filter((m) => m.type === 'geometry').length).toBeGreaterThanOrEqual(16);
    expect(median).toBeLessThan(16);
  });
});
