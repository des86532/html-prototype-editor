import { describe, expect, it } from 'vitest';
import {
  TokenBucket,
  buildPath,
  initials,
  matchesFilters,
  parseFrameMessage,
  pinPoint,
  DEFAULT_THREAD_FILTERS,
  type Thread,
} from './index.js';

const anchor = {
  pageId: 'index.html',
  kind: 'element' as const,
  viewport: { width: 1440, height: 900, dpr: 2 },
  selectors: {
    fingerprint: { tag: 'button', classes: [], textHash: 'h', siblingIndex: 0, depth: 3 },
    elementOffset: { x: 0.5, y: 0.5 },
  },
  fallback: { x: 10, y: 10, w: 100, h: 40 },
  snapshot: { tag: 'button', text: 'Buy' },
};

describe('parseFrameMessage', () => {
  it('accepts a valid pick and rejects oversize / malformed messages', () => {
    const rect = { x: 1, y: 2, w: 3, h: 4 };
    expect(parseFrameMessage({ v: 1, type: 'pick', draft: anchor, rect }).ok).toBe(true);
    expect(parseFrameMessage({ v: 2, type: 'pick', draft: anchor, rect }).ok).toBe(false);
    const huge = { v: 1, type: 'dialog', kind: 'alert', text: 'x'.repeat(70_000) };
    expect(parseFrameMessage(huge)).toEqual({ ok: false, reason: 'too-large' });
  });

  it('enforces selector and textQuote length caps', () => {
    const rect = { x: 0, y: 0, w: 1, h: 1 };
    const longCss = { ...anchor, selectors: { ...anchor.selectors, css: 'a'.repeat(1025) } };
    expect(parseFrameMessage({ v: 1, type: 'pick', draft: longCss, rect }).ok).toBe(false);
  });
});

describe('TokenBucket', () => {
  it('throttles to the per-second limit and refills over time', () => {
    let now = 0;
    const b = new TokenBucket(10, () => now);
    let passed = 0;
    for (let i = 0; i < 50; i++) if (b.take()) passed++;
    expect(passed).toBe(10);
    now += 500;
    expect(b.take()).toBe(true);
  });
});

describe('pinPoint', () => {
  it('applies elementOffset, scale and frame offset for element pins; top-right for regions', () => {
    const rect = { x: 100, y: 200, w: 80, h: 40 };
    expect(pinPoint('element', rect, { x: 0.5, y: 0.25 }, 0.5, { x: 10, y: 20 })).toEqual({
      x: 70 + 10,
      y: 105 + 20,
    });
    expect(pinPoint('region', rect, { x: 0.5, y: 0.25 }, 1, { x: 0, y: 0 })).toEqual({
      x: 180,
      y: 200,
    });
  });
});

describe('helpers', () => {
  it('buildPath encodes params and throws on missing ones', () => {
    expect(buildPath('getVersion', { id: 'a/b' })).toBe('/versions/a%2Fb');
    expect(() => buildPath('exportVersion', { id: 'x' })).toThrow();
  });
  it('initials handles latin and CJK names', () => {
    expect(initials('Ada Lovelace')).toBe('AL');
    expect(initials('王小明')).toBe('王小');
  });
  it('matchesFilters narrows by width and tag', () => {
    const t = {
      id: 't',
      versionId: 'v',
      number: 1,
      anchor,
      status: 'open',
      tags: ['bug'],
      createdBy: { kind: 'guest', guestId: 'g1', name: 'G' },
      createdAt: 'x',
      comments: [],
    } as Thread;
    expect(matchesFilters(t, DEFAULT_THREAD_FILTERS)).toBe(true);
    expect(matchesFilters(t, { ...DEFAULT_THREAD_FILTERS, width: 768 })).toBe(false);
    expect(matchesFilters(t, { ...DEFAULT_THREAD_FILTERS, tag: 'bug', authorId: 'g1' })).toBe(true);
  });
});
