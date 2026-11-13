import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EXPORT_SHELL_CSP,
  PAYLOAD_PLACEHOLDER,
  buildSingleFileHtml,
  type SingleFilePayload,
} from '../../exporter/src/index';
import { buildAnnotationsDocument } from '../../exporter/src/json';
import { makeInput, makeThread } from '../../exporter/src/fixtures';
import { readPayload, showFatal } from './boot';
import { resolvePageRequest } from './navigation';

const template = readFileSync(resolve(import.meta.dirname, '../index.html'), 'utf8');

function docWith(payloadText: string): Document {
  return new DOMParser().parseFromString(
    `<!doctype html><html><head></head><body><div id="root"></div><script type="application/json" id="hpe-data">${payloadText}</script></body></html>`,
    'text/html',
  );
}

describe('shell template', () => {
  it('has exactly one placeholder inside script#hpe-data and the exact export CSP meta', () => {
    expect(template.split(PAYLOAD_PLACEHOLDER)).toHaveLength(2);
    expect(template).toMatch(
      /<script type="application\/json" id="hpe-data">\s*<!--HPE_PAYLOAD-->\s*<\/script>/,
    );
    expect(template).toContain(`content="${EXPORT_SHELL_CSP}"`);
  });

  it('is accepted by buildSingleFileHtml', () => {
    const annotations = buildAnnotationsDocument(makeInput([makeThread(1)]));
    const r = buildSingleFileHtml({
      shellHtml: template,
      annotations,
      pages: { 'index.html': '<p>x</p>' },
      agentSource: '1',
      meta: { projectName: 'P', versionNumber: 1, entryPage: 'index.html', exportedAt: 'x' },
    });
    expect(r.html).not.toContain(PAYLOAD_PLACEHOLDER);
  });
});

describe('readPayload', () => {
  const annotations = buildAnnotationsDocument(
    makeInput([
      makeThread(1, {
        comments: [
          {
            id: 'c',
            threadId: 't1',
            author: { kind: 'user', userId: 'u', name: 'A' },
            body: '</script><!-- \u2028 ]]>',
            createdAt: '2026-01-01T00:00:00Z',
          },
        ],
      }),
    ]),
  );
  const payload: SingleFilePayload = {
    format: 'hpe-single-file',
    formatVersion: 1,
    meta: { projectName: 'P', versionNumber: 1, entryPage: 'index.html', exportedAt: 'x' },
    annotations,
    pages: { 'index.html': '<p>\u2028</p>' },
    agentSource: 'a',
  };

  it('parses an escaped payload via textContent', () => {
    const built = buildSingleFileHtml({
      shellHtml: template,
      annotations,
      pages: payload.pages,
      agentSource: 'a',
      meta: payload.meta,
    });
    const text = /id="hpe-data">([\s\S]*?)<\/script>/.exec(built.html)![1]!;
    const parsed = readPayload(docWith(text));
    expect(parsed.pages).toEqual(payload.pages);
    expect(parsed.annotations.items[0]!.body[0]!.value).toBe('</script><!-- \u2028 ]]>');
  });

  it('rejects an unfilled template, missing data and invalid data', () => {
    expect(() => readPayload(docWith(PAYLOAD_PLACEHOLDER))).toThrow(/範本/);
    expect(() => readPayload(new DOMParser().parseFromString('<p></p>', 'text/html'))).toThrow(
      /#hpe-data/,
    );
    expect(() => readPayload(docWith('{"format":"x"}'))).toThrow();
  });
});

describe('showFatal', () => {
  it('renders the message as text only', () => {
    const root = document.createElement('div');
    showFatal(root, new Error('<img src=x onerror=alert(1)>'));
    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('resolvePageRequest', () => {
  const pages = ['index.html', 'pricing.html', 'docs/a b.html', 'docs/index.html'];
  it('matches exact, normalised and encoded paths', () => {
    expect(resolvePageRequest('pricing.html', pages)).toBe('pricing.html');
    expect(resolvePageRequest('./pricing.html', pages)).toBe('pricing.html');
    expect(resolvePageRequest('/pricing.html#x', pages)).toBe('pricing.html');
    expect(resolvePageRequest('pricing.html?x=1', pages)).toBe('pricing.html');
    expect(resolvePageRequest('docs/a%20b.html', pages)).toBe('docs/a b.html');
    expect(resolvePageRequest('docs/', pages)).toBe('docs/index.html');
    expect(resolvePageRequest('', pages)).toBe('index.html');
  });
  it('returns null for unknown pages and bad encodings', () => {
    expect(resolvePageRequest('nope.html', pages)).toBeNull();
    expect(resolvePageRequest('%E0%A4%A', pages)).toBeNull();
    expect(resolvePageRequest('../etc/passwd', pages)).toBeNull();
  });
});
