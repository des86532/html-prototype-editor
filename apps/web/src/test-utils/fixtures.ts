import type { Markup, Author, Comment, Thread } from '@hpe/shared';

export const alice: Author = { kind: 'user', userId: 'u1', name: 'Alice Chen' };
export const bob: Author = { kind: 'guest', guestId: 'g1', name: 'Bob' };

export function makeMarkup(over: Partial<Markup> = {}): Markup {
  return {
    pageId: 'index.html',
    viewport: { width: 1440, height: 900 },
    shape: { kind: 'rect', x: 10, y: 10, w: 100, h: 40, color: '#e5484d', stroke: 4 },
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
    markup: makeMarkup(),
    status: 'open',
    createdBy: alice,
    createdAt: '2026-01-01T00:00:00.000Z',
    comments: [makeComment(`c${n}`, id, alice, `comment ${n}`)],
    ...over,
  };
}
