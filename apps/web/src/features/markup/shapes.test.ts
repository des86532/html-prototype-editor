import { describe, expect, it } from 'vitest';
import { MARKUP_LIMITS, type MarkupShape } from '@hpe/shared';
import { appendPoint, badgePoint, translateShape } from './shapes';

const style = { color: '#e5484d', stroke: 4 } as const;

describe('appendPoint', () => {
  it('skips points closer than 2px to the last one', () => {
    const pts: [number, number][] = [[0, 0]];
    expect(appendPoint(pts, 1, 1)).toBe(false);
    expect(appendPoint(pts, 2, 0)).toBe(true);
    expect(pts).toEqual([
      [0, 0],
      [2, 0],
    ]);
  });

  it('does not exceed the max point count', () => {
    const pts: [number, number][] = [];
    for (let i = 0; i < MARKUP_LIMITS.maxPoints; i++) expect(appendPoint(pts, i * 3, 0)).toBe(true);
    expect(appendPoint(pts, 99999, 0)).toBe(false);
    expect(pts).toHaveLength(MARKUP_LIMITS.maxPoints);
  });
});

describe('translateShape', () => {
  it('moves every shape kind', () => {
    const cases: [MarkupShape, MarkupShape][] = [
      [
        { kind: 'rect', x: 10, y: 20, w: 30, h: 40, ...style },
        { kind: 'rect', x: 15.5, y: 18, w: 30, h: 40, ...style },
      ],
      [
        { kind: 'arrow', from: { x: 0, y: 0 }, to: { x: 10, y: 10 }, ...style },
        { kind: 'arrow', from: { x: 5.5, y: -2 }, to: { x: 15.5, y: 8 }, ...style },
      ],
      [
        {
          kind: 'pen',
          points: [
            [0, 0],
            [4, 4],
          ],
          ...style,
        },
        {
          kind: 'pen',
          points: [
            [5.5, -2],
            [9.5, 2],
          ],
          ...style,
        },
      ],
      [
        {
          kind: 'highlighter',
          points: [
            [0, 0],
            [4, 4],
          ],
          ...style,
        },
        {
          kind: 'highlighter',
          points: [
            [5.5, -2],
            [9.5, 2],
          ],
          ...style,
        },
      ],
      [
        { kind: 'text', x: 1, y: 2, text: 'hi', ...style },
        { kind: 'text', x: 6.5, y: 0, text: 'hi', ...style },
      ],
    ];
    for (const [shape, want] of cases) {
      expect(translateShape(shape, 5.5, -2)).toEqual(want);
    }
  });

  it('rounds to 0.1', () => {
    const r = translateShape({ kind: 'rect', x: 0, y: 0, w: 1, h: 1, ...style }, 0.123, 0.987);
    expect(r).toMatchObject({ x: 0.1, y: 1 });
  });
});

describe('badgePoint', () => {
  it('is the top-right corner of a rect', () => {
    expect(badgePoint({ kind: 'rect', x: 10, y: 20, w: 100, h: 50, ...style })).toEqual({
      x: 110,
      y: 20,
    });
  });
});
