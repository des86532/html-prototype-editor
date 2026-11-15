import { describe, expect, it } from 'vitest';
import { wheelZoom, zoomStep } from './zoom';

describe('zoomStep', () => {
  it('moves to the next step and clamps at the bounds', () => {
    expect(zoomStep(0.33, 1)).toBe(0.5);
    expect(zoomStep(0.4, -1)).toBe(0.33);
    expect(zoomStep(3, 1)).toBe(3);
    expect(zoomStep(0.1, -1)).toBe(0.1);
  });
  it('treats values within 0.001 of a step as that step', () => {
    expect(zoomStep(0.3304, 1)).toBe(0.5);
    expect(zoomStep(1, -1)).toBe(0.75);
  });
});

describe('wheelZoom', () => {
  it('zooms out for positive dy and in for negative dy, clamped', () => {
    expect(wheelZoom(1, 100)).toBeCloseTo(0.819, 3);
    expect(wheelZoom(1, -100000)).toBe(3);
    expect(wheelZoom(0.2, 100000)).toBe(0.1);
  });
});
