import { describe, expect, it } from 'vitest';
import {
  CreateThreadBodySchema,
  TokenBucket,
  UpdateThreadBodySchema,
  authorColor,
  buildPath,
  initials,
  parseFrameMessage,
  parseParentMessage,
} from './index.js';

const markup = {
  pageId: 'index.html',
  viewport: { width: 1440, height: 900 },
  shape: { kind: 'rect', x: 10, y: 10, w: 100, h: 20, color: '#e5484d', stroke: 4 },
};

describe('parseFrameMessage', () => {
  it('accepts a valid scroll and rejects wrong version, wrong types and oversize messages', () => {
    const scroll = { v: 1, type: 'scroll', x: 0, y: 10, docW: 800, docH: 2000, vw: 800, vh: 600 };
    expect(parseFrameMessage(scroll).ok).toBe(true);
    expect(parseFrameMessage({ ...scroll, v: 2 }).ok).toBe(false);
    expect(parseFrameMessage({ ...scroll, docW: '800' }).ok).toBe(false);
    expect(parseFrameMessage({ ...scroll, x: Infinity }).ok).toBe(false);
    const huge = { v: 1, type: 'dialog', kind: 'alert', text: 'x'.repeat(70_000) };
    expect(parseFrameMessage(huge)).toEqual({ ok: false, reason: 'too-large' });
  });
  it('drops removed message types', () => {
    expect(
      parseFrameMessage({ v: 1, type: 'geometry', viewport: { w: 1, h: 1 }, rects: {} }).ok,
    ).toBe(false);
  });
});

describe('parseParentMessage', () => {
  it('accepts scrollTo/scrollBy and rejects non-finite numbers', () => {
    expect(parseParentMessage({ v: 1, type: 'scrollTo', x: 0, y: 120 }).ok).toBe(true);
    expect(parseParentMessage({ v: 1, type: 'scrollBy', dx: 0, dy: -4 }).ok).toBe(true);
    expect(parseParentMessage({ v: 1, type: 'scrollTo', x: 0, y: Infinity }).ok).toBe(false);
    expect(parseParentMessage({ v: 1, type: 'setMode', mode: 'comment' }).ok).toBe(false);
  });
});

describe('markup schemas', () => {
  it('create body allows a markup without a note', () => {
    expect(CreateThreadBodySchema.safeParse({ markup }).success).toBe(true);
    expect(CreateThreadBodySchema.safeParse({ markup, body: ' ' }).success).toBe(false);
  });
  it('only accepts palette colors', () => {
    const bad = { ...markup, shape: { ...markup.shape, color: 'red' } };
    expect(CreateThreadBodySchema.safeParse({ markup: bad }).success).toBe(false);
  });
  it('rejects pen strokes over the point cap', () => {
    const points = Array.from({ length: 2001 }, (_, i) => [i, i]);
    const pen = { ...markup, shape: { kind: 'pen', points, color: '#e5484d', stroke: 2 } };
    expect(CreateThreadBodySchema.safeParse({ markup: pen }).success).toBe(false);
  });
  it('update body needs at least one field', () => {
    expect(UpdateThreadBodySchema.safeParse({}).success).toBe(false);
    expect(UpdateThreadBodySchema.safeParse({ status: 'resolved' }).success).toBe(true);
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

describe('helpers', () => {
  it('buildPath encodes params and throws on missing ones', () => {
    expect(buildPath('getVersion', { id: 'a/b' })).toBe('/versions/a%2Fb');
    expect(() => buildPath('exportVersion', { id: 'x' })).toThrow();
  });
  it('initials handles latin and CJK names', () => {
    expect(initials('Ada Lovelace')).toBe('AL');
    expect(initials('王小明')).toBe('王小');
  });
  it('authorColor is stable per author', () => {
    const a = { kind: 'guest', guestId: 'g1', name: 'G' } as const;
    expect(authorColor(a)).toBe(authorColor(a));
  });
});
