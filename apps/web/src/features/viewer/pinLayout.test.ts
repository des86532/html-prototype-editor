import { describe, expect, it } from 'vitest';
import { computePinGeometry, edgeIndicator, isPointInView } from './pinLayout';

const rect = { x: 100, y: 200, w: 80, h: 40 };

describe('computePinGeometry (spec: Pin 位置公式)', () => {
  it('element: (rect.x + off.x*rect.w, rect.y + off.y*rect.h) * scale + frameOffset', () => {
    const g = computePinGeometry(
      { id: 'a', kind: 'element', elementOffset: { x: 0.25, y: 0.5 }, rect },
      0.5,
      { x: 10, y: 20 },
    )!;
    expect(g.point).toEqual({ x: (100 + 20) * 0.5 + 10, y: (200 + 20) * 0.5 + 20 });
    expect(g.box).toBeNull();
  });

  it('region: pin at the top-right of the region box; box is scaled', () => {
    const g = computePinGeometry(
      { id: 'a', kind: 'region', elementOffset: { x: 0.1, y: 0.1 }, rect },
      2,
      { x: 0, y: 0 },
    )!;
    expect(g.point).toEqual({ x: (100 + 80) * 2, y: 200 * 2 });
    expect(g.box).toEqual({ x: 200, y: 400, w: 160, h: 80 });
  });

  it('text: pin at the top-right of the last client rect', () => {
    const g = computePinGeometry(
      { id: 'a', kind: 'text', elementOffset: { x: 0, y: 0 }, rect },
      1,
      { x: 5, y: 5 },
    )!;
    expect(g.point).toEqual({ x: 185, y: 205 });
    expect(g.box).toEqual({ x: 105, y: 205, w: 80, h: 40 });
  });

  it('returns null while the rect is unknown', () => {
    expect(
      computePinGeometry(
        { id: 'a', kind: 'element', elementOffset: { x: 0, y: 0 }, rect: null },
        1,
      ),
    ).toBeNull();
  });

  it('scrolling the frame by dy moves the pin by dy*scale (relative position to the card stays)', () => {
    const at = (dy: number) =>
      computePinGeometry(
        {
          id: 'a',
          kind: 'element',
          elementOffset: { x: 0.5, y: 0.5 },
          rect: { ...rect, y: rect.y - dy },
        },
        0.8,
      )!.point;
    expect(at(0).y - at(300).y).toBeCloseTo(300 * 0.8);
    expect(at(0).x).toBe(at(300).x);
  });
});

describe('edge indicators', () => {
  const view = { w: 800, h: 600 };
  it('detects points inside / outside the viewport', () => {
    expect(isPointInView({ x: 10, y: 10 }, view)).toBe(true);
    expect(isPointInView({ x: 10, y: 700 }, view)).toBe(false);
    expect(isPointInView({ x: -5, y: 10 }, view)).toBe(false);
  });
  it('clamps to the nearest edge', () => {
    expect(edgeIndicator({ x: 400, y: 900 }, view)).toMatchObject({ side: 'bottom', x: 400 });
    expect(edgeIndicator({ x: 400, y: -300 }, view)).toMatchObject({ side: 'top', x: 400 });
    expect(edgeIndicator({ x: 1200, y: 300 }, view)).toMatchObject({ side: 'right', y: 300 });
    expect(edgeIndicator({ x: -50, y: 300 }, view)).toMatchObject({ side: 'left', y: 300 });
  });
});
