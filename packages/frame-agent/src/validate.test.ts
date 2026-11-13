import { ParentToFrameSchema } from '@hpe/shared';
import { describe, expect, it } from 'vitest';
import { parseParentMessageLite } from './validate.js';

const anchor = {
  pageId: 'index.html',
  kind: 'element',
  viewport: { width: 1440, height: 900, dpr: 2 },
  selectors: {
    css: '#a > b',
    textQuote: { exact: 'x', prefix: '', suffix: '' },
    fingerprint: { tag: 'div', classes: ['a'], textHash: 'h', siblingIndex: 0, depth: 3 },
    elementOffset: { x: 0.5, y: 0.5 },
  },
  fallback: { x: 1, y: 2, w: 3, h: 4 },
  snapshot: { tag: 'div', text: 'hi' },
};

const valid: unknown[] = [
  { v: 1, type: 'init', mode: 'interact' },
  { v: 1, type: 'init', mode: 'comment', storageSeed: '{"l":{}}' },
  { v: 1, type: 'setMode', mode: 'comment' },
  { v: 1, type: 'resolveAnchors', requestId: 'r1', anchors: [{ threadId: 't1', anchor }] },
  { v: 1, type: 'trackAnchors', threadIds: ['a', 'b'] },
  { v: 1, type: 'scrollToAnchor', threadId: 't1' },
  { v: 1, type: 'describeAt', requestId: 'r', point: { x: 1, y: 2 } },
  { v: 1, type: 'ping', seq: 3 },
];
const invalid: unknown[] = [
  null,
  'ping',
  [],
  { type: 'ping', seq: 1 },
  { v: 2, type: 'ping', seq: 1 },
  { v: 1, type: 'ping', seq: 1.5 },
  { v: 1, type: 'ping' },
  { v: 1, type: 'nope' },
  { v: 1, type: 'init', mode: 'evil' },
  { v: 1, type: 'trackAnchors', threadIds: [1] },
  { v: 1, type: 'trackAnchors', threadIds: [''] },
  { v: 1, type: 'describeAt', requestId: 'r', point: { x: NaN, y: 2 } },
  { v: 1, type: 'scrollToAnchor', threadId: 'x'.repeat(65) },
  {
    v: 1,
    type: 'resolveAnchors',
    requestId: 'r',
    anchors: [{ threadId: 't', anchor: { ...anchor, kind: 'bad' } }],
  },
  {
    v: 1,
    type: 'resolveAnchors',
    requestId: 'r',
    anchors: [{ threadId: 't', anchor: { ...anchor, fallback: {} } }],
  },
  { v: 1, type: 'init', mode: 'interact', storageSeed: 'x'.repeat(40 * 1024) },
];

describe('parseParentMessageLite', () => {
  it.each(valid)('accepts %j (agrees with the zod schema)', (msg) => {
    expect(ParentToFrameSchema.safeParse(msg).success).toBe(true);
    expect(parseParentMessageLite(msg).ok).toBe(true);
  });
  it.each(invalid)('rejects %j (agrees with the zod schema)', (msg) => {
    expect(ParentToFrameSchema.safeParse(msg).success).toBe(false);
    expect(parseParentMessageLite(msg).ok).toBe(false);
  });
  it('rejects messages over 64 KB', () => {
    const big = {
      v: 1,
      type: 'trackAnchors',
      threadIds: Array.from({ length: 500 }, () => 'x'.repeat(64)),
    };
    expect(parseParentMessageLite(big).ok).toBe(true); // 500 * 66 B ≈ 33 KB
    const huge = { v: 1, type: 'init', mode: 'interact', storageSeed: 'é'.repeat(32 * 1024) };
    expect(parseParentMessageLite(huge).ok).toBe(false);
  });
});
