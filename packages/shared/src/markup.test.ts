import { describe, expect, it } from 'vitest';
import { shapeBounds, textBox } from './markup.js';
import type { MarkupShape } from './types.js';

const style = { color: '#e5484d', stroke: 4 } as const;

describe('shapeBounds', () => {
  it('rect is its own box', () => {
    const s: MarkupShape = { kind: 'rect', x: 10, y: 20, w: 100, h: 50, ...style };
    expect(shapeBounds(s)).toEqual({ x: 10, y: 20, w: 100, h: 50 });
  });
  it('arrow pads the two-point box by stroke * 2', () => {
    const s: MarkupShape = {
      kind: 'arrow',
      from: { x: 10, y: 10 },
      to: { x: 50, y: 30 },
      ...style,
    };
    expect(shapeBounds(s)).toEqual({ x: 2, y: 2, w: 56, h: 36 });
  });
  it('pen pads by stroke, highlighter by stroke * 2', () => {
    const points: [number, number][] = [
      [0, 0],
      [10, 20],
    ];
    expect(shapeBounds({ kind: 'pen', points, ...style })).toEqual({ x: -4, y: -4, w: 18, h: 28 });
    expect(shapeBounds({ kind: 'highlighter', points, ...style })).toEqual({
      x: -8,
      y: -8,
      w: 26,
      h: 36,
    });
  });
  it('text uses the estimated text box anchored at its top-left', () => {
    const s: MarkupShape = { kind: 'text', x: 5, y: 6, text: 'ab', ...style };
    const b = shapeBounds(s);
    expect(b.x).toBe(5);
    expect(b.y).toBe(6);
    expect(b.w).toBeCloseTo(24);
    expect(b.h).toBeCloseTo(26);
  });
});

describe('textBox', () => {
  it('counts CJK as full width and latin as 0.6', () => {
    expect(textBox('標記A', 20).w).toBeCloseTo(20 + 20 + 12);
  });
});
