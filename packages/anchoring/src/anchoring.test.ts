import { AnchorSchema, MESSAGE_LIMITS, type Anchor } from '@hpe/shared';
import { describe as suite, expect, it } from 'vitest';
import {
  cssPath,
  describe,
  evalXPath,
  isHashLike,
  rectForAnchor,
  resolve,
  xpathOf,
} from './index.js';
import { buildTextIndex, findQuote, rangeFromIndex } from './textQuote.js';
import { fakeMeasure, load, selectText } from './testUtil.js';

const RICH = `<!doctype html><html><body>
<header id="top" class="css-1x2y3z site"><nav class="nav"><a href="/">Home</a><a href="/a" class="link">A</a><a href="/b" class="link">B</a></nav></header>
<main class="_a1b2c3 page"><ul class="list"><li>One</li><li>Two</li><li class="active">Three</li></ul>
<div class="sc-abc123"><span>x</span><span>y</span></div>
<svg width="10" height="10"><circle r="2"></circle><circle r="3"></circle></svg>
<form><input name="a"><input name="b"><button type="submit">Go</button></form>
<p>Hello <b>big</b> world, this is a sentence about anchoring.</p></main></body></html>`;

const viewport = { width: 1440, height: 900, dpr: 1 };
const desc = (el: Element, extra: Partial<Parameters<typeof describe>[0]> = {}) =>
  describe({
    element: el,
    kind: 'element',
    pageId: 'index.html',
    viewport,
    measure: fakeMeasure(),
    ...extra,
  });

suite('isHashLike', () => {
  it.each([
    'css-1x2y3z',
    'sc-abc123',
    'sc-bdVaJa',
    '_a1b2c3',
    'Button_root__3xK2a',
    'jsx-1234567',
    'svelte-1abcd',
    'a1b2c3d4e5',
    'emotion-1a2b3c',
    ':r1:',
    'e8f3a9b2c1',
  ])('flags %s as generated', (c) => expect(isHashLike(c)).toBe(true));

  it.each([
    'btn',
    'btn-primary',
    'nav-item',
    'card__title',
    'is-active',
    'col-md-12',
    'js-toggle',
    'hero',
    'signup',
  ])('keeps %s as stable', (c) => expect(isHashLike(c)).toBe(false));
});

suite('cssPath', () => {
  it('is unique for every element of a rich document and never uses hash-like classes', () => {
    const doc = load(RICH);
    for (const el of Array.from(doc.querySelectorAll('*'))) {
      const css = cssPath(el);
      expect(css, el.outerHTML.slice(0, 40)).toBeTruthy();
      const hits = doc.querySelectorAll(css!);
      expect(hits.length, css).toBe(1);
      expect(hits[0]).toBe(el);
      expect(css).not.toMatch(/css-1x2y3z|sc-abc123|_a1b2c3/);
      expect(css!.length).toBeLessThanOrEqual(MESSAGE_LIMITS.maxSelectorLength);
    }
  });

  it('prefers a stable unique id and is shortest', () => {
    const doc = load(RICH);
    expect(cssPath(doc.getElementById('top')!)).toBe('#top');
    expect(cssPath(doc.querySelector('li.active')!)).toBe('li.active');
  });

  it('uses :nth-child only when same-tag siblings are indistinguishable', () => {
    const doc = load(RICH);
    expect(cssPath(doc.querySelectorAll('li')[1]!)).toBe('li:nth-child(2)');
  });
});

suite('xpath', () => {
  it('round-trips every element (HTML and SVG)', () => {
    const doc = load(RICH);
    for (const el of Array.from(doc.querySelectorAll('*'))) {
      const xp = xpathOf(el)!;
      expect(evalXPath(doc, xp), xp).toBe(el);
    }
  });

  it('agrees with the native evaluator for HTML paths', () => {
    const doc = load(RICH);
    const el = doc.querySelector('li.active')!;
    const native = doc.evaluate(xpathOf(el)!, doc, null, 9, null).singleNodeValue;
    expect(native).toBe(el);
  });

  it('rejects anything outside the generated grammar', () => {
    const doc = load(RICH);
    for (const bad of [
      '',
      '//a',
      '/html[1]/body[1]/*',
      '/html[1]/body[99]',
      'html[1]',
      '/html[1]/@x',
      '/html[0]',
    ]) {
      expect(evalXPath(doc, bad), bad).toBeNull();
    }
  });
});

suite('textQuote', () => {
  const doc = load(RICH);
  const idx = buildTextIndex(doc.body);

  it('finds exact quotes and picks the occurrence whose context matches', () => {
    const d = load('<body><p>alpha item beta</p><p>gamma item delta</p></body>');
    const i = buildTextIndex(d.body);
    const m = findQuote(i, { exact: 'item', prefix: 'gamma ', suffix: ' delta' })[0]!;
    expect(i.text.slice(m.start - 6, m.end + 6)).toBe('gamma item delta');
    expect(m.fuzzy).toBe(false);
    const r = rangeFromIndex(i, d, m.start, m.end)!;
    expect(r.toString()).toBe('item');
  });

  it('matches fuzzily when the text was edited', () => {
    const m = findQuote(idx, {
      exact: 'this is a sentence about anchoring',
      prefix: '',
      suffix: '',
    })[0]!;
    expect(m.fuzzy).toBe(false);
    const edited = findQuote(idx, {
      exact: 'this is a sentance abut anchoring',
      prefix: '',
      suffix: '',
    })[0]!;
    expect(edited.fuzzy).toBe(true);
    expect(idx.text.slice(edited.start, edited.end)).toContain('sentence');
    expect(edited.score).toBeGreaterThan(0.5);
  });

  it('returns nothing for unrelated text and ignores script/style', () => {
    const d = load('<body><script>secret()</script><style>.x{}</style><p>visible</p></body>');
    const i = buildTextIndex(d.body);
    expect(i.text).toBe('visible');
    expect(findQuote(idx, { exact: 'zzzzzzzzzzzzzzzzzz qqqqq', prefix: '', suffix: '' })).toEqual(
      [],
    );
  });

  it('range crosses inline elements', () => {
    const p = doc.querySelector('p')!;
    const m = findQuote(buildTextIndex(p), {
      exact: 'Hello big world',
      prefix: '',
      suffix: '',
    })[0]!;
    expect(rangeFromIndex(buildTextIndex(p), doc, m.start, m.end)!.toString()).toBe(
      'Hello big world',
    );
  });
});

suite('describe', () => {
  it('prefers data-comment-anchor > data-testid > stable id and emits a schema-valid anchor', () => {
    const doc = load(
      '<body><div id="stable-id" data-testid="t" data-comment-anchor="a">x</div><p id="stable-id2" data-testid="t2">y</p><i id="x9f8e7d6c5b">z</i><u id="plain">w</u></body>',
    );
    const get = (sel: string) => desc(doc.querySelector(sel)!).anchor;
    expect(get('div').selectors.dataAttr).toEqual({ name: 'data-comment-anchor', value: 'a' });
    expect(get('p').selectors.dataAttr).toEqual({ name: 'data-testid', value: 't2' });
    expect(get('i').selectors.dataAttr).toBeUndefined();
    expect(get('u').selectors.dataAttr).toEqual({ name: 'id', value: 'plain' });
    for (const sel of ['div', 'p', 'i', 'u'])
      expect(() => AnchorSchema.parse(get(sel))).not.toThrow();
  });

  it('computes clamped elementOffset, fallback in document coords and snapshot', () => {
    const doc = load('<body><button class="b">Click   me</button></body>');
    const el = doc.querySelector('button')!;
    const measure = () => ({ x: 100, y: 200, w: 50, h: 20 });
    const { anchor, rect } = desc(el, {
      measure,
      point: { x: 125, y: 500 },
      scroll: { x: 10, y: 1000 },
    });
    expect(rect).toEqual({ x: 100, y: 200, w: 50, h: 20 });
    expect(anchor.selectors.elementOffset).toEqual({ x: 0.5, y: 1 });
    expect(anchor.fallback).toEqual({ x: 110, y: 1200, w: 50, h: 20 });
    expect(anchor.snapshot).toEqual({ tag: 'button', text: 'Click me' });
    expect(anchor.selectors.textQuote?.exact).toBe('Click me');
    expect(anchor.selectors.fingerprint).toMatchObject({
      tag: 'button',
      classes: ['b'],
      siblingIndex: 0,
      depth: 2,
    });
  });

  it('records region size relative to the common ancestor', () => {
    const doc = load('<body><section>hello</section></body>');
    const { anchor, rect } = desc(doc.querySelector('section')!, {
      kind: 'region',
      measure: () => ({ x: 0, y: 0, w: 200, h: 100 }),
      region: { x: 20, y: 10, w: 100, h: 50 },
    });
    expect(rect).toEqual({ x: 20, y: 10, w: 100, h: 50 });
    expect(anchor.selectors.regionSize).toEqual({ w: 0.5, h: 0.5 });
    expect(anchor.selectors.elementOffset).toEqual({ x: 0.1, y: 0.1 });
  });

  it('text anchors store a textQuote with prefix/suffix and use the last client rect', () => {
    const doc = load('<body><p>The quick brown fox jumps over the lazy dog</p></body>');
    const p = doc.querySelector('p')!;
    const { anchor, rect } = desc(p, {
      kind: 'text',
      range: selectText(p, 'brown fox'),
      measureRange: () => ({ x: 10, y: 20, w: 30, h: 10 }),
    });
    expect(rect).toEqual({ x: 10, y: 20, w: 30, h: 10 });
    expect(anchor.selectors.textQuote).toEqual({
      exact: 'brown fox',
      prefix: 'The quick ',
      suffix: ' jumps over the lazy dog',
    });
  });

  it('records state hints for open dialogs', () => {
    const doc = load('<body><dialog open><button>ok</button></dialog></body>');
    expect(desc(doc.querySelector('button')!).anchor.stateHint?.inDialog).toBe(true);
  });

  it('keeps long text within schema limits', () => {
    const doc = load(`<body><p>${'lorem ipsum '.repeat(200)}</p></body>`);
    expect(() => AnchorSchema.parse(desc(doc.querySelector('p')!).anchor)).not.toThrow();
  });
});

suite('resolve', () => {
  const make = (html: string, sel: string): { anchor: Anchor; doc: Document } => {
    const doc = load(html);
    return { doc, anchor: desc(doc.querySelector(sel)!).anchor };
  };

  it('is exact on an untouched document', () => {
    const { anchor, doc } = make(RICH, 'li.active');
    const r = resolve(anchor, doc, { measure: fakeMeasure() });
    expect(r).toMatchObject({ status: 'exact', element: doc.querySelector('li.active') });
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('survives hostile anchors without throwing', () => {
    const doc = load(RICH);
    const base = desc(doc.querySelector('li.active')!).anchor;
    const hostile: Anchor[] = [
      {
        ...base,
        selectors: {
          ...base.selectors,
          css: '>>> [[[',
          xpath: '/html[1]/(',
          dataAttr: { name: 'bad name"]', value: '"]' },
        },
      },
      {
        ...base,
        selectors: {
          ...base.selectors,
          css: ':nth-child(',
          textQuote: { exact: '\u0000'.repeat(100), prefix: '', suffix: '' },
        },
      },
      { ...base, fallback: { x: NaN, y: Infinity, w: 1, h: 1 } },
      {
        ...base,
        selectors: {
          ...base.selectors,
          fingerprint: { tag: '', classes: [], textHash: '', siblingIndex: -3, depth: 9999 },
        },
      },
    ];
    for (const a of hostile) {
      expect(() => resolve(a, doc, { measure: fakeMeasure() })).not.toThrow();
    }
    expect(resolve(hostile[2]!, doc, { measure: fakeMeasure() }).status).toBe('exact');
  });

  it('empty document: fallback with coordinates, orphaned beyond the document', () => {
    const { anchor } = make(RICH, 'li.active');
    const empty = load('<body></body>');
    const fb = resolve(anchor, empty, { measure: fakeMeasure() });
    expect(fb.status).toBe('fallback');
    expect(fb.rect).toEqual(anchor.fallback);
    expect(resolve(anchor, empty, { docSize: { w: 1440, h: 5 } }).status).toBe('orphaned');
  });

  it('scales fallback x with the viewport width', () => {
    const { anchor } = make(RICH, 'li.active');
    const r = resolve(anchor, load('<body></body>'), { viewportSize: { w: 720, h: 800 } });
    expect(r.rect!.x).toBeCloseTo(anchor.fallback.x / 2);
    expect(r.rect!.y).toBe(anchor.fallback.y);
  });

  it('explicit data-comment-anchor identity wins even if everything else changed', () => {
    const a = make(
      '<body><div><button data-comment-anchor="k">Buy</button></div></body>',
      'button',
    );
    const doc2 = load(
      '<body><section><p>zzz</p><a data-comment-anchor="k" class="q">Totally different</a></section></body>',
    );
    expect(resolve(a.anchor, doc2, { measure: fakeMeasure() }).status).toBe('exact');
  });

  it('reports hidden with a null rect for zero-size elements', () => {
    const { anchor, doc } = make(RICH, 'li.active');
    const r = resolve(anchor, doc, { measure: () => ({ x: 0, y: 0, w: 0, h: 0 }) });
    expect(r).toMatchObject({ status: 'hidden', rect: null });
    expect(r.element).toBe(doc.querySelector('li.active'));
  });

  it('honors an injected isVisible', () => {
    const { anchor, doc } = make(RICH, 'li.active');
    expect(resolve(anchor, doc, { measure: fakeMeasure(), isVisible: () => false }).status).toBe(
      'hidden',
    );
  });

  it('text anchors resolve to a range and its client rect', () => {
    const doc = load('<body><p>The quick brown fox jumps over the lazy dog</p></body>');
    const p = doc.querySelector('p')!;
    const { anchor } = desc(p, {
      kind: 'text',
      range: selectText(p, 'brown fox'),
      measureRange: () => ({ x: 1, y: 1, w: 1, h: 1 }),
    });
    const doc2 = load('<body><div><p>The quick brown fox jumps over the lazy dog</p></div></body>');
    const r = resolve(anchor, doc2, { measure: fakeMeasure() });
    expect(r.range?.toString()).toBe('brown fox');
    expect(
      rectForAnchor(anchor, r, doc2, {
        measure: fakeMeasure(),
        measureRange: () => ({ x: 7, y: 8, w: 9, h: 10 }),
      }),
    ).toEqual({ x: 7, y: 8, w: 9, h: 10 });
  });
});
