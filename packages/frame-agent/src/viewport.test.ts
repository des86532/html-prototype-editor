// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createViewport } from './viewport.js';
import { fakeBridge, fakeRaf } from './testBridge.js';

function setup() {
  const b = fakeBridge();
  const r = fakeRaf();
  const dispose = createViewport({ raf: r.raf, cancelRaf: r.cancelRaf })(b.bridge);
  return { ...b, ...r, dispose };
}
const scrollEvents = (sent: ReturnType<typeof fakeBridge>['sent']) =>
  sent.filter((m) => m.type === 'scroll');

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true, writable: true });
});

describe('viewport', () => {
  it('sends a scroll message on install', () => {
    const t = setup();
    expect(scrollEvents(t.sent)).toHaveLength(1);
    t.dispose();
  });

  it('reports scroll changes once and skips identical measurements', () => {
    const t = setup();
    Object.defineProperty(window, 'scrollY', { value: 300, configurable: true, writable: true });
    window.dispatchEvent(new Event('scroll'));
    t.flush();
    const msgs = scrollEvents(t.sent);
    expect(msgs).toHaveLength(2);
    expect(msgs[1]).toMatchObject({ type: 'scroll', y: 300 });
    window.dispatchEvent(new Event('scroll'));
    t.flush();
    expect(scrollEvents(t.sent)).toHaveLength(2);
    t.dispose();
  });

  it('handles scrollTo from the parent', () => {
    const t = setup();
    const spy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    t.deliver({ v: 1, type: 'scrollTo', x: 0, y: 120 });
    expect(spy).toHaveBeenCalledWith({ left: 0, top: 120, behavior: 'instant' });
    t.dispose();
  });

  it('handles scrollBy from the parent', () => {
    const t = setup();
    const spy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    t.deliver({ v: 1, type: 'scrollBy', dx: 0, dy: 40 });
    expect(spy).toHaveBeenCalledWith({ left: 0, top: 40, behavior: 'instant' });
    t.dispose();
  });

  it('stops reporting after dispose', () => {
    const t = setup();
    t.dispose();
    Object.defineProperty(window, 'scrollY', { value: 500, configurable: true, writable: true });
    window.dispatchEvent(new Event('scroll'));
    t.flush();
    expect(scrollEvents(t.sent)).toHaveLength(1);
    expect(t.subs.size).toBe(0);
  });
});
