// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createWheelZoom } from './wheelZoom.js';
import { fakeBridge, fakeRaf } from './testBridge.js';

function setup() {
  const b = fakeBridge();
  const r = fakeRaf();
  const dispose = createWheelZoom({ raf: r.raf, cancelRaf: r.cancelRaf })(b.bridge);
  return { ...b, ...r, dispose };
}
const wheel = (deltaY: number, mods: { ctrlKey?: boolean; metaKey?: boolean } = {}) => {
  const e = new WheelEvent('wheel', { deltaY, clientX: 7, clientY: 9, cancelable: true, ...mods });
  document.body.dispatchEvent(e);
  return e;
};

describe('wheelZoom', () => {
  it('coalesces ctrl+wheel into one message and prevents browser zoom', () => {
    const t = setup();
    const a = wheel(10, { ctrlKey: true });
    const b = wheel(5, { metaKey: true });
    t.flush();
    expect(t.sent).toEqual([{ v: 1, type: 'zoomWheel', dy: 15, x: 7, y: 9 }]);
    expect(a.defaultPrevented).toBe(true);
    expect(b.defaultPrevented).toBe(true);
    t.dispose();
  });

  it('ignores plain wheel', () => {
    const t = setup();
    const e = wheel(10);
    t.flush();
    expect(t.sent).toHaveLength(0);
    expect(e.defaultPrevented).toBe(false);
    t.dispose();
  });

  it('stops after dispose', () => {
    const t = setup();
    t.dispose();
    wheel(10, { ctrlKey: true });
    t.flush();
    expect(t.sent).toHaveLength(0);
  });
});
