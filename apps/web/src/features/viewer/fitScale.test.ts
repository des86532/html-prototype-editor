import { describe, expect, it } from 'vitest';
import { fitScale } from './fitScale';

describe('fitScale', () => {
  it('is bound by height when the device is taller than the canvas', () => {
    expect(fitScale({ w: 1500, h: 800 }, { width: 768, height: 1024 })).toBeCloseTo(
      (800 - 64) / 1024,
    );
  });

  it('is bound by width when the device is wider than the canvas', () => {
    expect(fitScale({ w: 900, h: 2000 }, { width: 1440, height: 900 })).toBeCloseTo(
      (900 - 64) / 1440,
    );
  });

  it('never scales up', () => {
    expect(fitScale({ w: 4000, h: 4000 }, { width: 390, height: 844 })).toBe(1);
  });

  it('returns 1 before the container is measured', () => {
    expect(fitScale({ w: 0, h: 0 }, { width: 1440, height: 900 })).toBe(1);
  });

  it('clamps to 0.1', () => {
    expect(fitScale({ w: 70, h: 70 }, { width: 1440, height: 900 })).toBe(0.1);
  });
});
