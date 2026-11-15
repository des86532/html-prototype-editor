// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createPointer } from './pointer.js';
import { fakeBridge, fakeRaf } from './testBridge.js';

function setup() {
  const b = fakeBridge();
  const r = fakeRaf();
  const dispose = createPointer({ raf: r.raf, cancelRaf: r.cancelRaf })(b.bridge);
  return { ...b, ...r, dispose };
}
const move = (x: number, y: number) => {
  const e = new Event('pointermove', { bubbles: true }) as Event & {
    clientX: number;
    clientY: number;
  };
  e.clientX = x;
  e.clientY = y;
  document.body.dispatchEvent(e);
};

describe('pointer', () => {
  it('coalesces pointermoves into one message per frame', () => {
    const t = setup();
    move(10, 20);
    move(30, 40);
    t.flush();
    expect(t.sent).toEqual([{ v: 1, type: 'pointer', x: 30, y: 40 }]);
    move(30, 40);
    t.flush();
    expect(t.sent).toHaveLength(1);
    t.dispose();
  });

  it('sends null on pointerleave and on blur', () => {
    const t = setup();
    move(5, 6);
    t.flush();
    document.documentElement.dispatchEvent(new Event('pointerleave'));
    expect(t.sent.at(-1)).toMatchObject({ type: 'pointer', x: null, y: null });
    move(5, 6);
    t.flush();
    window.dispatchEvent(new Event('blur'));
    expect(t.sent).toHaveLength(4);
    t.dispose();
  });

  it('stops reporting after dispose', () => {
    const t = setup();
    t.dispose();
    move(1, 1);
    t.flush();
    expect(t.sent).toHaveLength(0);
  });
});
