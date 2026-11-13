import type { Anchor, Author, PrototypeVersion, Thread } from '@hpe/shared';
import type { ExportInput } from './types.js';

export const NOW = new Date('2026-03-01T08:30:00.000Z');

export const alice: Author = { kind: 'user', userId: 'u1', name: 'Alice' };
export const guest: Author = { kind: 'guest', guestId: 'g1', name: 'Gus' };

export function makeAnchor(over: Partial<Anchor> = {}): Anchor {
  return {
    pageId: 'index.html',
    kind: 'element',
    viewport: { width: 1280, height: 800, dpr: 2, preset: 'desktop' },
    selectors: {
      css: 'main > button.cta',
      xpath: '/html/body/main/button[1]',
      textQuote: { exact: 'Buy now', prefix: 'Hero ', suffix: ' today' },
      fingerprint: { tag: 'button', classes: ['cta'], textHash: 'abc', siblingIndex: 0, depth: 3 },
      elementOffset: { x: 0.25, y: 0.5 },
    },
    fallback: { x: 10, y: 20, w: 100, h: 40 },
    snapshot: { tag: 'button', text: 'Buy now' },
    ...over,
  };
}

export function makeThread(n: number, over: Partial<Thread> = {}): Thread {
  const id = `t${n}`;
  return {
    id,
    versionId: 'v1',
    number: n,
    anchor: makeAnchor(),
    status: 'open',
    tags: ['bug'],
    createdBy: alice,
    createdAt: '2026-02-01T10:00:00.000Z',
    comments: [
      {
        id: `${id}c1`,
        threadId: id,
        author: alice,
        body: `first ${n}`,
        createdAt: '2026-02-01T10:00:00.000Z',
      },
      {
        id: `${id}c2`,
        threadId: id,
        author: guest,
        body: `reply ${n}`,
        createdAt: '2026-02-01T11:00:00.000Z',
        editedAt: '2026-02-01T12:00:00.000Z',
      },
    ],
    ...over,
  };
}

export function makeVersion(over: Partial<PrototypeVersion> = {}): PrototypeVersion {
  return {
    id: 'v1',
    projectId: 'p1',
    number: 3,
    contentKey: 'ck',
    entryPage: 'index.html',
    pages: [
      { path: 'index.html', title: 'Home' },
      { path: 'pricing.html', title: null },
    ],
    cdnAllowlist: ['https://cdn.jsdelivr.net'],
    analysis: {
      scripts: { inline: 0, external: [] },
      externalResources: [],
      forms: 0,
      passwordInputs: 0,
      iframes: [],
      metaRefresh: false,
      baseTag: false,
      serviceWorkerRegistration: false,
      warnings: [],
    },
    status: 'ready',
    createdAt: '2026-02-01T00:00:00.000Z',
    ...over,
  };
}

export function makeInput(threads: Thread[], over: Partial<ExportInput> = {}): ExportInput {
  return {
    project: { id: 'p1', name: 'Demo Project' },
    version: makeVersion(),
    threads,
    now: NOW,
    ...over,
  };
}

export const HOSTILE_BODIES = [
  '<script>alert(1)</script>',
  '[x](javascript:alert(1))',
  '</script><script>alert(2)</script>',
  '![img](javascript:alert(3))\n# heading injection\n- list\n1. one\n---\n=== \n```\ncode fence',
  '<img src=x onerror=alert(4)>',
  'line1\r\nline2\u2028line3\u2029line4',
  '=HYPERLINK("evil")',
];
