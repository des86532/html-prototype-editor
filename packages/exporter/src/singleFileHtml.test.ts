import { describe, expect, it } from 'vitest';
import { buildAnnotationsDocument } from './json.js';
import { inlineAssets } from './inlineAssets.js';
import {
  EXPORT_SHELL_CSP,
  PAYLOAD_PLACEHOLDER,
  escapeJsonForScript,
  injectAgent,
} from './browser.js';
import { buildSingleFileHtml, extractPayload } from './singleFileHtml.js';
import { exportFilename, slugify } from './common.js';
import { HOSTILE_BODIES, makeInput, makeThread } from './fixtures.js';

const SHELL = `<!doctype html><html><head><meta charset="utf-8"><title>shell</title></head><body><div id="root"></div><script type="application/json" id="hpe-data">${PAYLOAD_PLACEHOLDER}</script><script>/* shell code */</script></body></html>`;

const HOSTILE_PAGE = `<!doctype html><html><head><title>t</title></head><body>
<script>var a="</script><script>alert(1)</script>"; var b="<!--"; var c="]]>"; var d="\u2028\u2029"; var e="$& $1 $'";</script>
<p>\u2028 ]]> <!-- &amp; </p></body></html>`;

describe('escapeJsonForScript', () => {
  it('escapes < > & U+2028 U+2029 and round-trips', () => {
    const value = { s: '</script><!-- & ]]> \u2028\u2029 "q" \\ ' };
    const esc = escapeJsonForScript(JSON.stringify(value));
    expect(esc).not.toMatch(/[<>&\u2028\u2029]/);
    expect(esc).toContain('\\u003c');
    expect(esc).toContain('\\u2028');
    expect(JSON.parse(esc)).toEqual(value);
  });
});

describe('buildSingleFileHtml', () => {
  const threads = HOSTILE_BODIES.map((body, i) =>
    makeThread(i + 1, {
      comments: [
        {
          id: `c${i}`,
          threadId: `t${i + 1}`,
          author: { kind: 'user', userId: 'u', name: '</script>' },
          body,
          createdAt: '2026-02-01T10:00:00.000Z',
        },
      ],
    }),
  );
  const annotations = buildAnnotationsDocument(makeInput(threads));
  const { pages } = inlineAssets({
    bundle: new Map([['index.html', { data: new TextEncoder().encode(HOSTILE_PAGE) }]]),
  });
  const agentSource = '(function(){var x="</script><!--";})();';
  const meta = {
    projectName: 'Demo',
    versionNumber: 3,
    entryPage: 'index.html',
    exportedAt: annotations.exportedAt,
  };
  const result = buildSingleFileHtml({ shellHtml: SHELL, annotations, pages, agentSource, meta });

  it('payload parses back identically (V21, V19)', () => {
    const payload = extractPayload(result.html);
    expect(payload.pages).toEqual(pages);
    expect(payload.agentSource).toBe(agentSource);
    expect(payload.annotations).toEqual(annotations);
    expect(payload.meta).toEqual(meta);
    expect(payload.annotations.items.map((i) => i.body[0]!.value)).toEqual(HOSTILE_BODIES);
  });

  it('has no raw </script or <!-- inside the data block and the file structure is intact', () => {
    const open = result.html.indexOf('id="hpe-data">');
    const close = result.html.indexOf('</script>', open);
    const block = result.html.slice(open, close);
    expect(block).not.toMatch(/<\/script/i);
    expect(block.slice('id="hpe-data">'.length)).not.toMatch(/[<>&\u2028\u2029]/);
    expect(result.html).not.toContain(PAYLOAD_PLACEHOLDER);
    expect((result.html.match(/<\/script>/g) ?? []).length).toBe(2);
    expect(result.html.endsWith('</body></html>')).toBe(true);
  });

  it('sets the exact shell CSP once, as the first head child', () => {
    expect(EXPORT_SHELL_CSP).toBe(
      "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'",
    );
    expect(result.html).toContain(
      `<head><meta http-equiv="Content-Security-Policy" content="${EXPORT_SHELL_CSP}">`,
    );
    expect(result.html.match(/Content-Security-Policy/g)).toHaveLength(1);
  });

  it('replaces an existing CSP meta instead of adding a second one', () => {
    const shell = SHELL.replace(
      '<meta charset="utf-8">',
      `<meta http-equiv="Content-Security-Policy" content="default-src *">`,
    );
    const r = buildSingleFileHtml({ shellHtml: shell, annotations, pages, agentSource, meta });
    expect(r.html.match(/Content-Security-Policy/g)).toHaveLength(1);
    expect(r.html).not.toContain('default-src *');
  });

  it('rejects shells with missing or duplicated placeholders', () => {
    const opts = { annotations, pages, agentSource, meta };
    expect(() => buildSingleFileHtml({ shellHtml: '<head></head>', ...opts })).toThrow();
    expect(() =>
      buildSingleFileHtml({ shellHtml: SHELL + PAYLOAD_PLACEHOLDER, ...opts }),
    ).toThrow();
  });

  it('reports size and the 20 MB warning', () => {
    expect(result.warnLarge).toBe(false);
    expect(result.bytes).toBe(Buffer.byteLength(result.html));
    const big = buildSingleFileHtml({
      shellHtml: SHELL,
      annotations,
      pages: { 'index.html': 'x'.repeat(21 * 1024 * 1024) },
      agentSource,
      meta,
    });
    expect(big.warnLarge).toBe(true);
  });
});

describe('injectAgent', () => {
  it('puts an escaped inline agent first in <head>', () => {
    const out = injectAgent(
      '<!doctype html><html><head><title>x</title></head><body></body></html>',
      'a="</script>"',
      'p"&<.html',
    );
    expect(out).toContain(
      '<head><script>window.__HPE_EXPORT__=true</script><script data-hpe-page="p&quot;&amp;&lt;.html">a="<\\/script>"</script><title>',
    );
  });
  it('creates a head when missing', () => {
    expect(injectAgent('<html><body></body></html>', 'x', 'a.html')).toContain(
      '<html><head><script',
    );
    expect(injectAgent('<p>x</p>', 'x', 'a.html').startsWith('<head><script')).toBe(true);
  });
});

describe('filenames', () => {
  it('builds review-{slug}-v{n}-{date}', () => {
    expect(
      exportFilename({
        projectName: 'My Cool Project!',
        versionNumber: 3,
        date: new Date('2026-03-01T00:00:00Z'),
        ext: 'html',
      }),
    ).toBe('review-my-cool-project-v3-2026-03-01.html');
    expect(slugify('原型設計')).toBe('project');
    expect(slugify('../../etc')).toBe('etc');
  });
});
