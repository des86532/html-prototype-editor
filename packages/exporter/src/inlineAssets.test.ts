import { describe, expect, it } from 'vitest';
import { inlineAssets, parseSrcset, resolveBundlePath } from './inlineAssets.js';
import type { Bundle } from './types.js';

const enc = new TextEncoder();
const text = (s: string) => ({ data: enc.encode(s) });
const b64 = (s: string) => Buffer.from(s).toString('base64');

function run(files: Record<string, string>, pages?: string[]) {
  const bundle: Bundle = new Map(Object.entries(files).map(([k, v]) => [k, text(v)]));
  return inlineAssets({ bundle, ...(pages ? { pages } : {}) });
}

describe('resolveBundlePath', () => {
  it('resolves relative, absolute, parent and encoded refs', () => {
    expect(resolveBundlePath('a/b/index.html', '../x.png?v=1#f')?.path).toBe('a/x.png');
    expect(resolveBundlePath('a/index.html', '/img/x.png')?.path).toBe('img/x.png');
    expect(resolveBundlePath('index.html', 'my%20file.png')?.path).toBe('my file.png');
    expect(resolveBundlePath('index.html', '../../etc/passwd')).toBeNull();
  });
});

describe('parseSrcset', () => {
  it('handles descriptors and commas inside data URIs', () => {
    expect(parseSrcset('a.png 1x, data:image/png;base64,AAA 2x,b.png 100w')).toEqual([
      { url: 'a.png', descriptor: '1x' },
      { url: 'data:image/png;base64,AAA', descriptor: '2x' },
      { url: 'b.png', descriptor: '100w' },
    ]);
    expect(parseSrcset('a.png,  b.png')).toEqual([
      { url: 'a.png', descriptor: '' },
      { url: 'b.png', descriptor: '' },
    ]);
  });
});

describe('inlineAssets: HTML attributes', () => {
  it('inlines img, srcset, source, poster, icon, svg image/use', () => {
    const { pages, report } = run({
      'index.html': `<!doctype html><html><head><link rel="icon" href="fav.ico"></head><body>
        <img src="a.png" srcset="a.png 1x, b.png 2x" alt="x">
        <picture><source srcset="b.png" type="image/png"></picture>
        <video poster="a.png" src="v.mp4"></video>
        <svg><image href="a.png"/><image xlink:href="b.png"/><use href="sprite.svg#i"/></svg>
        <a href="pricing.html">Pricing</a>
      </body></html>`,
      'fav.ico': 'ICO',
      'a.png': 'AAA',
      'b.png': 'BBB',
      'v.mp4': 'VID',
      'sprite.svg': '<svg/>',
      'pricing.html': '<p>p</p>',
    });
    const html = pages['index.html']!;
    expect(html).toContain(`href="data:image/x-icon;base64,${b64('ICO')}"`);
    expect(html).toContain(`src="data:image/png;base64,${b64('AAA')}"`);
    expect(html).toContain(
      `data:image/png;base64,${b64('AAA')} 1x, data:image/png;base64,${b64('BBB')} 2x`,
    );
    expect(html).toContain(`poster="data:image/png;base64,${b64('AAA')}"`);
    expect(html).toContain(`src="data:video/mp4;base64,${b64('VID')}"`);
    expect(html).toContain(`xlink:href="data:image/png;base64,${b64('BBB')}"`);
    expect(html).toContain(`href="data:image/svg+xml;base64,${b64('<svg/>')}#i"`);
    expect(html).toContain('<a href="pricing.html">Pricing</a>');
    expect(report.unresolved).toEqual([]);
    expect(Object.keys(pages).sort()).toEqual(['index.html', 'pricing.html']);
  });

  it('reports remote and missing, leaves data: alone', () => {
    const { pages, report } = run({
      'index.html': `<img src="https://evil.test/x.png"><img src="//cdn.test/y.png"><img src="missing.png"><img src="data:image/png;base64,QQ=="><link rel="stylesheet" href="https://cdn.test/a.css"><script src="https://cdn.test/a.js"></script>`,
    });
    expect(pages['index.html']).toContain('src="https://evil.test/x.png"');
    expect(pages['index.html']).toContain('src="data:image/png;base64,QQ=="');
    expect(report.remote.map((r) => r.url).sort()).toEqual([
      '//cdn.test/y.png',
      'https://cdn.test/a.css',
      'https://cdn.test/a.js',
      'https://evil.test/x.png',
    ]);
    expect(report.remote.find((r) => r.url.endsWith('a.css'))?.kind).toBe('style');
    expect(report.unresolved).toEqual([
      { page: 'index.html', ref: 'missing.png', from: 'index.html', reason: 'missing' },
    ]);
  });

  it('does not escape the bundle root', () => {
    const { report } = run({ 'index.html': '<img src="../secret.png">' });
    expect(report.unresolved[0]?.reason).toBe('escapes-root');
  });
});

describe('inlineAssets: CSS', () => {
  it('inlines stylesheet links, nested @import, url() forms and style attributes', () => {
    const { pages, report } = run({
      'index.html': `<link rel="stylesheet" href="css/main.css" media="print"><style>@import "css/inline.css"; .x{background:url( 'img/a.png' )}</style><div style="background:url(img/a.png)"></div>`,
      'css/main.css': `@import url("sub/base.css") screen;\n.a{background:url(../img/a.png)} .f{src:url("../fonts/f.woff2") format("woff2")} /* url(nope.png) */ .s::after{content:"url(nope.png)"} .e{background:url('../img/sp\\61 ce.png')}`,
      'css/sub/base.css': `.b{background:url(../../img/b.png)}`,
      'css/inline.css': `.i{color:red}`,
      'img/a.png': 'AAA',
      'img/b.png': 'BBB',
      'img/space.png': 'SPC',
      'fonts/f.woff2': 'FONT',
    });
    const html = pages['index.html']!;
    expect(html).not.toContain('<link');
    expect(html).toContain('<style media="print">');
    expect(html).toContain(`@media screen{`);
    expect(html).toContain(`url("data:image/png;base64,${b64('BBB')}")`);
    expect(html).toContain(`url("data:font/woff2;base64,${b64('FONT')}") format("woff2")`);
    expect(html).toContain(`url("data:image/png;base64,${b64('SPC')}")`);
    expect(html).toContain('/* url(nope.png) */');
    expect(html).toContain('content:"url(nope.png)"');
    expect(html).toContain('.i{color:red}');
    expect(html).not.toContain('@import');
    expect(html).toMatch(/<div style="background:url\(&quot;data:image\/png;base64,QUFB&quot;\)">/);
    expect(report.unresolved).toEqual([]);
  });

  it('guards against @import cycles and depth', () => {
    const cyc = run({
      'index.html': '<link rel="stylesheet" href="a.css">',
      'a.css': '@import "b.css"; .a{}',
      'b.css': '@import "a.css"; .b{}',
    });
    expect(cyc.pages['index.html']).toContain('.a{}');
    expect(cyc.pages['index.html']).toContain('.b{}');
    expect(cyc.report.unresolved.map((u) => u.reason)).toEqual(['cycle']);

    const files: Record<string, string> = { 'index.html': '<link rel="stylesheet" href="c0.css">' };
    for (let i = 0; i < 20; i++) files[`c${i}.css`] = `@import "c${i + 1}.css"; .c${i}{}`;
    files['c20.css'] = '.end{}';
    const deep = run(files);
    expect(deep.report.unresolved.some((u) => u.reason === 'depth')).toBe(true);
    expect(deep.pages['index.html']).not.toContain('.end{}');
  });

  it('reports remote @import and missing url()', () => {
    const { pages, report } = run({
      'index.html': '<link rel="stylesheet" href="a.css">',
      'a.css':
        '@import url(https://fonts.test/x.css);\n.a{background:url(gone.png)} .b{background:url(https://x.test/b.png)}',
    });
    expect(pages['index.html']).toContain('@import url(https://fonts.test/x.css);');
    expect(report.remote.map((r) => r.url).sort()).toEqual([
      'https://fonts.test/x.css',
      'https://x.test/b.png',
    ]);
    expect(report.unresolved).toEqual([
      { page: 'index.html', ref: 'gone.png', from: 'a.css', reason: 'missing' },
    ]);
  });

  it('escapes </style in inlined CSS', () => {
    const { pages } = run({
      'index.html': '<link rel="stylesheet" href="a.css">',
      'a.css': '.a::after{content:"</style><script>alert(1)</script>"}',
    });
    expect(pages['index.html']).not.toMatch(/<\/style><script>/);
    expect((pages['index.html']!.match(/<\/style>/gi) ?? []).length).toBe(1);
  });
});

describe('inlineAssets: scripts', () => {
  it('inlines external scripts with safe escaping and relocates deferred ones', () => {
    const { pages, report } = run({
      'index.html': `<html><head><script src="d.js" defer integrity="x" crossorigin></script><script src="app.js"></script></head><body><p>hi</p></body></html>`,
      'app.js': `var s="</script><script>alert(1)</script>"; var c="<!--";`,
      'd.js': 'window.d=1;',
    });
    const html = pages['index.html']!;
    expect(html).not.toContain('src="app.js"');
    expect(html).toContain('<\\/script>');
    expect(html).toContain('<\\!--');
    expect(html).not.toContain('integrity');
    expect(html.indexOf('window.d=1;')).toBeGreaterThan(html.indexOf('<p>hi</p>'));
    expect(report.inlined).toBe(2);
    // 結構完整：恰有 2 個 </script>
    expect((html.match(/<\/script>/g) ?? []).length).toBe(2);
  });
});

describe('inlineAssets: accounting', () => {
  it('counts bytes and sets the large flag', () => {
    const small = run({ 'index.html': '<p>x</p>' });
    expect(small.report.totalBytes).toBe(Buffer.byteLength(small.pages['index.html']!));
    expect(small.report.warnLarge).toBe(false);
    const big = run({
      'index.html': `<img src="big.bin">`,
      'big.bin': 'x'.repeat(16 * 1024 * 1024),
    });
    expect(big.report.warnLarge).toBe(true);
  });
});
