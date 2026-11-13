import { describe, expect, it } from 'vitest';
import { annotationsToThreads, parsePayload, serializePayload } from './browser.js';
import { buildAnnotationsDocument } from './json.js';
import { makeAnchor, makeInput, makeThread } from './fixtures.js';

describe('annotationsToThreads', () => {
  it('restores threads (ids, numbers, anchors, comments) sorted by number', () => {
    const threads = [
      makeThread(2, { status: 'resolved', resolvedAt: '2026-02-03T00:00:00Z', tags: ['copy'] }),
      makeThread(1, { anchor: makeAnchor({ pageId: 'pricing.html' }) }),
    ];
    const doc = buildAnnotationsDocument(makeInput(threads));
    const back = annotationsToThreads(doc);
    expect(back.map((t) => t.number)).toEqual([1, 2]);
    expect(back).toEqual(
      [...threads].sort((a, b) => a.number - b.number).map((t) => ({ ...t, versionId: 'v1' })),
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
