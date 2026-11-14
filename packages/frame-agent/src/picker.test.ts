// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Anchor, Rect } from '@hpe/shared';
import { installPicker } from './picker.js';
import { fakeBridge, fakeRaf, setBody } from './testBridge.js';

const raf = fakeRaf();
const disposers: (() => void)[] = [];

const rects = new Map<Element, Rect>();
function setup(mode: 'comment' | 'interact' = 'comment') {
  const fb = fakeBridge();
  disposers.push(installPicker(fb.bridge));
  fb.deliver({ v: 1, type: 'init', mode });
  return fb;
}
const fire = (target: EventTarget, type: string, init: MouseEventInit = {}) => {
  const e = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    button: 0,
    ...init,
  });
  target.dispatchEvent(e);
  return e;
};
const picks = (sent: { type: string }[]) =>
  sent.filter((m) => m.type === 'pick') as unknown as { draft: Anchor; rect: Rect }[];

beforeEach(() => {
  setBody(
    `<main id="m"><section id="s"><button id="b" class="cta">Buy now</button><p id="p">Orders are delivered within two days.</p></section><div id="other">other</div></main>`,
  );
  rects.clear();
  rects.set(document.getElementById('b')!, { x: 100, y: 100, w: 80, h: 40 });
  rects.set(document.getElementById('p')!, { x: 100, y: 160, w: 300, h: 20 });
  rects.set(document.getElementById('s')!, { x: 90, y: 90, w: 400, h: 120 });
  rects.set(document.getElementById('m')!, { x: 0, y: 0, w: 800, h: 600 });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const r = rects.get(this) ?? { x: 0, y: 0, w: 0, h: 0 };
    return {
      left: r.x,
      top: r.y,
      width: r.w,
      height: r.h,
      right: r.x + r.w,
      bottom: r.y + r.h,
      x: r.x,
      y: r.y,
      toJSON: () => r,
    } as DOMRect;
  });
  vi.stubGlobal('requestAnimationFrame', raf.raf);
  vi.stubGlobal('cancelAnimationFrame', raf.cancelRaf);
});
afterEach(() => {
  disposers.splice(0).forEach((d) => d());
  window.getSelection()?.removeAllRanges();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('picker: interact mode', () => {
  it('is inert: page handlers run and nothing is sent', () => {
    const { sent } = setup('interact');
    const onClick = vi.fn();
    const b = document.getElementById('b')!;
    b.addEventListener('click', onClick);
    fire(b, 'pointerdown', { clientX: 120, clientY: 120 });
    fire(b, 'pointerup', { clientX: 120, clientY: 120 });
    fire(b, 'click', { clientX: 120, clientY: 120 });
    fire(b, 'mouseover');
    raf.flush();
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([]);
  });
});

describe('picker: comment mode', () => {
  it('single click picks an element anchor and hides the events from the page', () => {
    const { sent } = setup();
    const b = document.getElementById('b')!;
    const seen = vi.fn();
    for (const t of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click'])
      b.addEventListener(t, seen);
    fire(b, 'pointerdown', { clientX: 140, clientY: 110 });
    fire(b, 'mousedown', { clientX: 140, clientY: 110 });
    fire(b, 'pointerup', { clientX: 140, clientY: 110 });
    fire(b, 'mouseup', { clientX: 140, clientY: 110 });
    const click = fire(b, 'click', { clientX: 140, clientY: 110 });
    expect(seen).not.toHaveBeenCalled();
    expect(click.defaultPrevented).toBe(true);
    const [pick, ...rest] = picks(sent);
    expect(rest).toEqual([]);
    expect(pick!.draft.kind).toBe('element');
    expect(pick!.draft.pageId).toBe('index.html');
    expect(pick!.draft.selectors.elementOffset).toEqual({ x: 0.5, y: 0.25 });
    expect(pick!.draft.selectors.css).toBe('#b');
    expect(pick!.rect).toEqual({ x: 100, y: 100, w: 80, h: 40 });
  });

  it('works with plain mouse events when pointer events are absent', () => {
    const { sent } = setup();
    const b = document.getElementById('b')!;
    fire(b, 'mousedown', { clientX: 101, clientY: 101 });
    fire(b, 'mouseup', { clientX: 101, clientY: 101 });
    expect(picks(sent)).toHaveLength(1);
  });

  it('ignores non-primary buttons', () => {
    const { sent } = setup();
    const b = document.getElementById('b')!;
    fire(b, 'pointerdown', { button: 2 });
    fire(b, 'pointerup', { button: 2 });
    expect(picks(sent)).toHaveLength(0);
  });

  it('a movement within the 8px threshold is still a click', () => {
    const { sent } = setup();
    const b = document.getElementById('b')!;
    fire(b, 'pointerdown', { clientX: 120, clientY: 120 });
    fire(b, 'pointermove', { clientX: 125, clientY: 124 });
    fire(b, 'pointerup', { clientX: 125, clientY: 124 });
    expect(picks(sent)[0]!.draft.kind).toBe('element');
  });

  it('a click in the gap beside a child binds to the nearest child within 16px', () => {
    const { sent } = setup();
    const s = document.getElementById('s')!;
    fire(s, 'pointerdown', { clientX: 185, clientY: 120 });
    fire(s, 'pointerup', { clientX: 185, clientY: 120 });
    const [pick] = picks(sent);
    expect(pick!.draft.selectors.css).toBe('#b');
    expect(pick!.draft.selectors.elementOffset!.x).toBe(1);
  });

  it('a click farther than 16px from every child stays on the container', () => {
    const { sent } = setup();
    const s = document.getElementById('s')!;
    fire(s, 'pointerdown', { clientX: 470, clientY: 195 });
    fire(s, 'pointerup', { clientX: 470, clientY: 195 });
    expect(picks(sent)[0]!.draft.selectors.css).toBe('#s');
  });

  it('hover outlines the child the click would bind to', () => {
    const { sent } = setup();
    const s = document.getElementById('s')!;
    fire(s, 'pointermove', { clientX: 185, clientY: 120 });
    raf.flush();
    expect(sent.filter((m) => m.type === 'hover').at(-1)).toMatchObject({
      rect: { x: 100, y: 100, w: 80, h: 40 },
    });
  });

  it('a drag past 8px is a region anchored on the common ancestor, with rubber-band hover', () => {
    const { sent } = setup();
    const b = document.getElementById('b')!;
    const p = document.getElementById('p')!;
    fire(b, 'pointerdown', { clientX: 120, clientY: 110 });
    fire(p, 'pointermove', { clientX: 300, clientY: 170 });
    raf.flush();
    const hover = sent.filter((m) => m.type === 'hover');
    expect(hover.at(-1)).toMatchObject({ rect: { x: 120, y: 110, w: 180, h: 60 }, label: '區域' });
    fire(p, 'pointerup', { clientX: 300, clientY: 170 });
    const pick = picks(sent)[0]!;
    expect(pick.draft.kind).toBe('region');
    expect(pick.rect).toEqual({ x: 120, y: 110, w: 180, h: 60 });
    // #s (90,90,400,120) is the smallest ancestor whose bbox covers the region
    expect(pick.draft.selectors.css).toBe('#s');
    expect(pick.draft.selectors.regionSize).toEqual({ w: 0.45, h: 0.5 });
    expect(sent.at(-1)).toMatchObject({ type: 'hover', rect: null });
  });

  it('a completed text selection becomes a text pick with a textQuote', () => {
    const { sent } = setup();
    const p = document.getElementById('p')!;
    const node = p.firstChild!;
    const r = document.createRange();
    r.setStart(node, 11);
    r.setEnd(node, 20);
    window.getSelection()!.addRange(r);
    fire(p, 'pointerdown', { clientX: 110, clientY: 165 });
    fire(p, 'pointerup', { clientX: 200, clientY: 165 });
    const pick = picks(sent)[0]!;
    expect(pick.draft.kind).toBe('text');
    expect(pick.draft.selectors.textQuote?.exact).toBe('delivered');
    expect(pick.draft.selectors.textQuote?.prefix).toContain('Orders are');
  });

  it('Alt passes the whole gesture through to the prototype', () => {
    const { sent } = setup();
    const b = document.getElementById('b')!;
    const seen: string[] = [];
    for (const t of ['pointerdown', 'pointerup', 'click'])
      b.addEventListener(t, () => seen.push(t));
    fire(b, 'pointerdown', { altKey: true });
    fire(b, 'pointerup', { altKey: false });
    const click = fire(b, 'click', { altKey: true });
    expect(seen).toEqual(['pointerdown', 'pointerup', 'click']);
    expect(click.defaultPrevented).toBe(false);
    expect(picks(sent)).toHaveLength(0);
  });

  it('reports hover rects with a short label, coalesced per frame, and clears on leave', () => {
    const { sent } = setup();
    const b = document.getElementById('b')!;
    fire(b, 'mouseover');
    fire(b, 'pointerover');
    fire(b, 'pointermove');
    expect(sent).toHaveLength(0);
    raf.flush();
    expect(sent).toEqual([
      { v: 1, type: 'hover', rect: { x: 100, y: 100, w: 80, h: 40 }, label: 'button#b "Buy now"' },
    ]);
    fire(b, 'mouseout', { relatedTarget: null });
    raf.flush();
    expect(sent.at(-1)).toMatchObject({ type: 'hover', rect: null });
  });

  it('Escape cancels a drag in progress', () => {
    const { sent } = setup();
    const b = document.getElementById('b')!;
    fire(b, 'pointerdown', { clientX: 100, clientY: 100 });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fire(b, 'pointerup', { clientX: 300, clientY: 300 });
    expect(picks(sent)).toHaveLength(0);
  });

  it('describeAt answers in both modes with the same requestId', () => {
    const b = document.getElementById('b')!;
    document.elementFromPoint = () => b;
    for (const mode of ['interact', 'comment'] as const) {
      const { sent, deliver } = setup(mode);
      deliver({ v: 1, type: 'describeAt', requestId: 'r1', point: { x: 120, y: 105 } });
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        type: 'described',
        requestId: 'r1',
        rect: { x: 100, y: 100, w: 80, h: 40 },
      });
    }
  });

  it('setMode(interact) detaches; dispose leaves no listeners behind', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const fb = fakeBridge();
    const dispose = installPicker(fb.bridge);
    fb.deliver({ v: 1, type: 'setMode', mode: 'comment' });
    const added = add.mock.calls.filter((c) => c[2] === true).length;
    expect(added).toBeGreaterThan(5);
    const onClick = vi.fn();
    const b = document.getElementById('b')!;
    b.addEventListener('click', onClick);
    fire(b, 'click');
    expect(onClick).not.toHaveBeenCalled();
    fb.deliver({ v: 1, type: 'setMode', mode: 'interact' });
    fire(b, 'click');
    expect(onClick).toHaveBeenCalledTimes(1);
    fb.deliver({ v: 1, type: 'setMode', mode: 'comment' });
    dispose();
    expect(fb.subs.size).toBe(0);
    const addedTotal = add.mock.calls.length;
    const removedTotal = remove.mock.calls.length;
    expect(removedTotal).toBe(addedTotal);
    fire(b, 'click');
    expect(onClick).toHaveBeenCalledTimes(2);
  });
});
