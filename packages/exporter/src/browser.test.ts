import { describe, expect, it } from 'vitest';
import { annotationsToThreads, parsePayload, serializePayload } from './browser.js';
import { buildAnnotationsDocument } from './json.js';
import { makeMarkup, makeInput, makeThread } from './fixtures.js';

describe('annotationsToThreads', () => {
  it('restores threads (ids, numbers, markups, comments) sorted by createdAt', () => {
    const threads = [
      makeThread(2, {
        status: 'resolved',
        resolvedAt: '2026-02-03T00:00:00Z',
        createdAt: '2026-02-01T11:00:00.000Z',
      }),
      makeThread(1, { markup: makeMarkup({ pageId: 'pricing.html' }) }),
      makeThread(3, { number: null, comments: [], createdAt: '2026-02-01T12:00:00.000Z' }),
    ];
    const doc = buildAnnotationsDocument(makeInput(threads));
    const back = annotationsToThreads(doc);
    expect(back.map((t) => t.number)).toEqual([1, 2, null]);
    expect(back).toEqual(
      [threads[1]!, threads[0]!, threads[2]!].map((t) => ({ ...t, versionId: 'v1' })),
    );
  });

  it('omits resolvedAt when absent', () => {
    const doc = buildAnnotationsDocument(makeInput([makeThread(1)]));
    expect('resolvedAt' in annotationsToThreads(doc)[0]!).toBe(false);
  });
});

describe('parsePayload', () => {
  const doc = buildAnnotationsDocument(makeInput([makeThread(1)]));
  const payload = {
    format: 'hpe-single-file' as const,
    formatVersion: 1 as const,
    meta: { projectName: 'P', versionNumber: 1, entryPage: 'index.html', exportedAt: 'x' },
    annotations: doc,
    pages: { 'index.html': '<p>x</p>' },
    agentSource: '1',
  };

  it('accepts the escaped serialisation', () => {
    expect(parsePayload(serializePayload(payload))).toEqual(payload);
  });

  it('rejects malformed payloads', () => {
    expect(() => parsePayload('[]')).toThrow();
    expect(() => parsePayload(JSON.stringify({ ...payload, formatVersion: 2 }))).toThrow();
    expect(() => parsePayload(JSON.stringify({ ...payload, pages: { a: 1 } }))).toThrow();
    expect(() => parsePayload(JSON.stringify({ ...payload, annotations: {} }))).toThrow();
    expect(() => parsePayload(JSON.stringify({ ...payload, agentSource: 1 }))).toThrow();
  });
});
