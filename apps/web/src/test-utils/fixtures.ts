import type { Anchor, Author, Comment, Thread } from '@hpe/shared';

export const alice: Author = { kind: 'user', userId: 'u1', name: 'Alice Chen' };
export const bob: Author = { kind: 'guest', guestId: 'g1', name: 'Bob' };

export function makeAnchor(over: Partial<Anchor> = {}): Anchor {
  return {
    pageId: 'index.html',
    kind: 'element',
    viewport: { width: 1440, height: 900, dpr: 1 },
    selectors: {
      css: '#btn',
      fingerprint: { tag: 'button', classes: [], textHash: 'h', siblingIndex: 0, depth: 3 },
      elementOffset: { x: 0.5, y: 0.5 },
    },
    fallback: { x: 10, y: 10, w: 100, h: 40 },
    snapshot: { tag: 'button', text: 'Buy' },
    ...over,
  };
}

export function makeComment(id: string, threadId: string, author: Author, body: string): Comment {
  return { id, threadId, author, body, createdAt: '2026-01-01T00:00:00.000Z' };
}

export function makeThread(n: number, over: Partial<Thread> = {}): Thread {
  const id = over.id ?? `t${n}`;
  return {
    id,
    versionId: 'v1',
    number: n,
    anchor: makeAnchor(),
    status: 'open',
    tags: [],
    createdBy: alice,
    createdAt: '2026-01-01T00:00:00.000Z',
    comments: [makeComment(`c${n}`, id, alice, `comment ${n}`)],
    ...over,
  };
}
