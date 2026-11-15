import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFullPageHeight } from './useFullPageHeight';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const setup = (frameKey = 0) =>
  renderHook((p) => useFullPageHeight(p), {
    initialProps: { frameKey, width: 1440, deviceHeight: 900 },
  });

describe('useFullPageHeight', () => {
  it('settles on the measured page height after the quiet period', () => {
    const { result } = setup();
    act(() => result.current.onScrollMessage({ docH: 2400, vh: 900 }));
    act(() => void vi.advanceTimersByTime(399));
    expect(result.current).toMatchObject({ pageHeight: 900, settled: false });
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current).toMatchObject({ pageHeight: 2400, settled: true });
  });

  it('keeps the largest docH while messages keep arriving, then ignores later growth', () => {
    const { result } = setup();
    act(() => result.current.onScrollMessage({ docH: 1500, vh: 900 }));
    act(() => void vi.advanceTimersByTime(300));
    act(() => result.current.onScrollMessage({ docH: 2400, vh: 900 }));
    act(() => void vi.advanceTimersByTime(400));
    expect(result.current.pageHeight).toBe(2400);
    act(() => result.current.onScrollMessage({ docH: 5000, vh: 2400 }));
    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current.pageHeight).toBe(2400);
  });

  it('ignores messages measured at a different viewport height', () => {
    const { result } = setup();
    act(() => result.current.onScrollMessage({ docH: 5000, vh: 1200 }));
    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current).toMatchObject({ pageHeight: 900, settled: false });
  });

  it('settles at the latest after the max wait even if messages never stop', () => {
    const { result } = setup();
    for (let i = 0; i < 20; i++) {
      act(() => result.current.onScrollMessage({ docH: 1000 + i, vh: 900 }));
      act(() => void vi.advanceTimersByTime(100));
    }
    expect(result.current.settled).toBe(true);
  });

  it('caps the height', () => {
    const { result } = setup();
    act(() => result.current.onScrollMessage({ docH: 50000, vh: 900 }));
    act(() => void vi.advanceTimersByTime(400));
    expect(result.current.pageHeight).toBe(20000);
  });

  it('resets when the frame reloads', () => {
    const { result, rerender } = setup();
    act(() => result.current.onScrollMessage({ docH: 2400, vh: 900 }));
    act(() => void vi.advanceTimersByTime(400));
    rerender({ frameKey: 1, width: 1440, deviceHeight: 900 });
    expect(result.current).toMatchObject({ pageHeight: 900, settled: false });
  });
});
