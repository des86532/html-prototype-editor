import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  buildReviewPackage,
  parseReviewPackage,
  reviewPackageToImportDraft,
  threadsToImportDraft,
} from './package.js';
import { HOSTILE_BODIES, makeAnchor, makeInput, makeThread } from './fixtures.js';

const enc = new TextEncoder();
const bundle = new Map([
  ['index.html', { data: enc.encode('<p>hi</p>') }],
  ['img/a.png', { data: new Uint8Array([1, 2, 3, 255]) }],
]);

describe('Review Package', () => {
  const threads = [
    makeThread(1),
    makeThread(2, {
      status: 'resolved',
      resolvedAt: '2026-02-03T00:00:00Z',
      tags: ['copy', 'design'],
      anchor: makeAnchor({
        pageId: 'pricing.html',
        kind: 'region',
        selectors: { ...makeAnchor().selectors, regionSize: { w: 0.5, h: 0.25 } },
      }),
      comments: HOSTILE_BODIES.map((body, i) => ({
        id: `c${i}`,
        threadId: 't2',
        author: { kind: 'guest' as const, guestId: 'g', name: 'G' },
        body,
        createdAt: '2026-02-01T10:00:00.000Z',
      })),
    }),
    makeThread(3, { tags: [], comments: [] }),
  ];

  it('round-trips threads (count, bodies, anchors, statuses) ignoring ids', () => {
    const zip = buildReviewPackage({ input: makeInput(threads), bundle });
    const pkg = parseReviewPackage(zip);
    expect(pkg.manifest).toMatchObject({
      format: 'hpe-review-package',
      projectName: 'Demo Project',
      versionNumber: 3,
      entryPage: 'index.html',
      cdnAllowlist: ['https://cdn.jsdelivr.net'],
    });
    const draft = reviewPackageToImportDraft(pkg);
    expect(draft.threads).toHaveLength(3);
    expect(draft).toEqual(threadsToImportDraft(threads));
    expect(draft.threads[1]!.comments.map((c) => c.body)).toEqual(HOSTILE_BODIES);
    expect(draft.threads[1]!.anchor.kind).toBe('region');
  });

  it('returns bundle files raw, plus extras', () => {
    const pkg = parseReviewPackage(buildReviewPackage({ input: makeInput(threads), bundle }));
    expect(pkg.files.map((f) => f.path).sort()).toEqual(['img/a.png', 'index.html']);
    expect([...pkg.files.find((f) => f.path === 'img/a.png')!.data]).toEqual([1, 2, 3, 255]);
    expect(pkg.extraEntries).toEqual([]);
  });

  it('does not sanitise paths (import pipeline does) but reports extras', () => {
    const good = parseReviewPackage(buildReviewPackage({ input: makeInput([]), bundle }));
    const zip = zipSync({
      'manifest.json': enc.encode(JSON.stringify(good.manifest)),
      'annotations.json': enc.encode(JSON.stringify(good.annotations)),
      'bundle/../evil.html': enc.encode('x'),
      'other.txt': enc.encode('x'),
    });
    const pkg = parseReviewPackage(zip);
    expect(pkg.files.map((f) => f.path)).toEqual(['../evil.html']);
    expect(pkg.extraEntries).toEqual(['other.txt']);
  });

  it('rejects invalid archives, manifests and annotations', () => {
    expect(() => parseReviewPackage(enc.encode('nope'))).toThrow(/zip/);
    expect(() => parseReviewPackage(zipSync({ 'x.txt': enc.encode('x') }))).toThrow(/manifest/);
    const good = parseReviewPackage(buildReviewPackage({ input: makeInput([]), bundle }));
    expect(() =>
      parseReviewPackage(
        zipSync({
          'manifest.json': enc.encode(JSON.stringify({ ...good.manifest, formatVersion: 2 })),
          'annotations.json': enc.encode(JSON.stringify(good.annotations)),
        }),
      ),
    ).toThrow(/manifest/);
    expect(() =>
      parseReviewPackage(
        zipSync({
          'manifest.json': enc.encode(JSON.stringify(good.manifest)),
          'annotations.json': enc.encode('{"items":1}'),
        }),
      ),
    ).toThrow(/annotations/);
  });
});
