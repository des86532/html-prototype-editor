import { ParentToFrameSchema } from '@hpe/shared';
import { describe, expect, it } from 'vitest';
import { parseParentMessageLite } from './validate.js';

const valid: unknown[] = [
  { v: 1, type: 'init' },
  { v: 1, type: 'init', storageSeed: '{"l":{}}' },
  { v: 1, type: 'scrollTo', x: 0, y: 120.5 },
  { v: 1, type: 'scrollBy', dx: -3, dy: 40 },
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
  { v: 1, type: 'setMode', mode: 'comment' },
  { v: 1, type: 'trackAnchors', threadIds: ['a'] },
  { v: 1, type: 'init', storageSeed: 5 },
  { v: 1, type: 'scrollTo', x: 0 },
  { v: 1, type: 'scrollTo', x: '1', y: 2 },
  { v: 1, type: 'scrollTo', x: NaN, y: 2 },
  { v: 1, type: 'scrollBy', dx: Infinity, dy: 0 },
  { v: 1, type: 'scrollBy', dx: 1 },
  { v: 1, type: 'init', storageSeed: 'x'.repeat(40 * 1024) },
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
    const ok = { v: 1, type: 'init', storageSeed: 'x'.repeat(30 * 1024) };
    expect(parseParentMessageLite(ok).ok).toBe(true);
    const huge = { v: 1, type: 'init', storageSeed: 'é'.repeat(32 * 1024) };
    expect(parseParentMessageLite(huge).ok).toBe(false);
  });
});
