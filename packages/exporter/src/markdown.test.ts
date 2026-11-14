import { describe, expect, it } from 'vitest';
import { buildMarkdown, escapeMarkdown, toBlockquote } from './markdown.js';
import { HOSTILE_BODIES, makeAnchor, makeInput, makeThread } from './fixtures.js';

describe('escapeMarkdown', () => {
  it('escapes every markdown control character', () => {
    for (const ch of '\\`*_{}[]()#+-.!|<>~&=') {
      expect(escapeMarkdown(`a${ch}b`)).toBe(`a\\${ch}b`);
    }
  });

  it('collapses line breaks and strips control chars', () => {
    expect(escapeMarkdown('a\nb\r\nc\u2028d\u0000e')).toBe('a b c de');
  });

  it('neutralises dangerous schemes', () => {
    expect(escapeMarkdown('javascript:alert(1)')).toBe('javascript\\:alert\\(1\\)');
    expect(escapeMarkdown('JaVaScRiPt :x')).toContain('\\:');
  });

  it('property: no unescaped special char survives (fuzz)', () => {
    const alphabet = 'ab \\`*_{}[]()#+-.!|<>~&=:\n\r\u2028>"\'1';
    let seed = 42;
    const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32;
    for (let n = 0; n < 500; n++) {
      let s = '';
      const len = Math.floor(rnd() * 30);
      for (let i = 0; i < len; i++) s += alphabet[Math.floor(rnd() * alphabet.length)];
      const out = escapeMarkdown(s);
      // 每個特殊字元前面都必須有奇數個反斜線
      for (let i = 0; i < out.length; i++) {
        if (/[`*_{}[\]()#+\-.!|<>~&=]/.test(out[i]!)) {
          let bs = 0;
          for (let j = i - 1; j >= 0 && out[j] === '\\'; j--) bs++;
          expect(bs % 2).toBe(1);
        }
      }
      expect(out).not.toMatch(/[\n\r\u2028]/);
    }
  });
});

describe('toBlockquote', () => {
  it('prefixes every line, including injected newlines', () => {
    const out = toBlockquote('a\n# b\r\n- c\u2028```\n\nlast');
    for (const line of out.split('\n')) expect(line.startsWith('>')).toBe(true);
    expect(out.split('\n')).toHaveLength(6);
    expect(out).toContain('> \\# b');
  });
});

describe('buildMarkdown', () => {
  it('groups by page with pin numbering and metadata', () => {
    const t12 = makeThread(12, {
      tags: ['bug', 'copy'],
      status: 'resolved',
      resolvedAt: '2026-02-02T00:00:00Z',
    });
    const t2 = makeThread(2, { anchor: makeAnchor({ pageId: 'pricing.html' }) });
    const t1 = makeThread(1);
    const md = buildMarkdown(makeInput([t12, t2, t1]));
    const iHome = md.indexOf('## 頁面：index\\.html');
    const iPricing = md.indexOf('## 頁面：pricing\\.html');
    expect(iHome).toBeGreaterThan(-1);
    expect(iPricing).toBeGreaterThan(iHome);
    expect(md.indexOf('### #1')).toBeLessThan(md.indexOf('### #12'));
    expect(md.indexOf('### #12')).toBeLessThan(iPricing);
    expect(md).toContain('- 狀態：已解決');
    expect(md).toContain('- 標籤：bug, copy');
    expect(md).toContain('- 作者：Alice');
    expect(md).toContain('- Breakpoint：1280px \\(desktop\\)');
    expect(md).toContain('- 元素：\\<button\\> "Buy now"');
    expect(md).toContain('Selector：main \\> button\\.cta');
    expect(md).toContain('回覆 1');
    expect(md).toContain('> first 1');
  });

  it('keeps hostile content inert (V19)', () => {
    const threads = HOSTILE_BODIES.map((body, i) =>
      makeThread(i + 1, {
        createdBy: { kind: 'guest', guestId: 'g', name: '<script>x</script>' },
        anchor: makeAnchor({
          snapshot: { tag: 'a', text: '[x](javascript:alert(1))\n# h' },
          selectors: { ...makeAnchor().selectors, css: '</script><script>' },
        }),
        comments: [
          {
            id: `c${i}`,
            threadId: `t${i + 1}`,
            author: { kind: 'guest', guestId: 'g', name: '| evil |' },
            body,
            createdAt: '2026-02-01T10:00:00.000Z',
          },
        ],
      }),
    );
    const md = buildMarkdown(makeInput(threads, { project: { id: 'p', name: '<b>proj</b>' } }));
    // 沒有任何未跳脫的 `<`、反引號、`](`
    expect(md).not.toMatch(/(^|[^\\])</);
    expect(md).not.toMatch(/(^|[^\\])`/);
    expect(md).not.toMatch(/(^|[^\\])\]\(/);
    expect(md).not.toMatch(/javascript:/i);
    // 只有我們自己的標題行（# 開頭）；注入的 `# heading` 都在引用區塊內且被跳脫
    for (const line of md.split('\n')) {
      if (line.startsWith('#')) expect(line).toMatch(/^#{1,3} (#\d+|[^\n]*)/);
    }
    const bodyLines = md.split('\n').filter((l) => /heading injection|code fence|list/.test(l));
    for (const l of bodyLines) expect(l.startsWith('>')).toBe(true);
  });
});
