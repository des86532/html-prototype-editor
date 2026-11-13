import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SafeMarkdown } from './SafeMarkdown';
import { installTrustedTypesPolicy, sanitizeToString } from './sanitize';
import { isSafeHref, renderMarkdownUnsafe } from './markdown';

function renderMd(src: string) {
  const { container } = render(<SafeMarkdown source={src} />);
  return container;
}

const VECTORS = [
  '<script>alert(1)</script>',
  '</script><script>alert(1)</script>',
  '[x](javascript:alert(1))',
  '[x](JaVaScRiPt:alert(1))',
  '[x](java\tscript:alert(1))',
  '[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
  '[x](vbscript:msgbox(1))',
  '<img src=x onerror=alert(1)>',
  '![x](https://evil.example/pixel.png)',
  '<a href="javascript:alert(1)" onclick="alert(1)">x</a>',
  '**<svg onload=alert(1)>**',
  '> <iframe src="https://evil.example"></iframe>',
  '[a [b](javascript:alert(1))](javascript:alert(2))',
  '<https://evil.example/"onmouseover="alert(1)>',
  'javascript:alert(1)',
  '<style>*{background:url(https://evil.example)}</style>',
];

describe('SafeMarkdown XSS vectors (V19)', () => {
  for (const v of VECTORS) {
    it(`neutralises ${JSON.stringify(v).slice(0, 60)}`, () => {
      const root = renderMd(v);
      expect(root.querySelector('script, img, svg, iframe, style, object, form, input')).toBeNull();
      for (const el of Array.from(root.querySelectorAll('*'))) {
        for (const attr of Array.from(el.attributes)) {
          expect(attr.name.startsWith('on')).toBe(false);
        }
      }
      for (const a of Array.from(root.querySelectorAll('a'))) {
        const href = a.getAttribute('href') ?? '';
        expect(href).toMatch(/^(https?:|mailto:)/i);
      }
    });
  }

  it('renders markup in the source as visible text', () => {
    const root = renderMd('<img src=x onerror=alert(1)>');
    expect(root.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('keeps safe links with hardened rel/target', () => {
    const a = renderMd('[ok](https://example.com/a?b=1)').querySelector('a')!;
    expect(a.getAttribute('href')).toBe('https://example.com/a?b=1');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer nofollow');
    expect(renderMd('[m](mailto:a@b.co)').querySelector('a')?.getAttribute('href')).toBe(
      'mailto:a@b.co',
    );
  });

  it('linkifies bare http(s) urls only', () => {
    const root = renderMd('see https://example.com and www.example.org and foo@bar.com');
    const hrefs = Array.from(root.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['https://example.com']);
  });

  it('renders basic formatting and nested lists', () => {
    const root = renderMd('**b** _i_ `c`\n\n- one\n  - two');
    expect(root.querySelector('strong')?.textContent).toBe('b');
    expect(root.querySelector('em')?.textContent).toBe('i');
    expect(root.querySelector('code')?.textContent).toBe('c');
    expect(root.querySelectorAll('li').length).toBe(2);
  });
});

describe('markdown helpers', () => {
  it('isSafeHref allows only http(s)/mailto', () => {
    expect(isSafeHref('https://a.b')).toBe(true);
    expect(isSafeHref('  javascript:1')).toBe(false);
    expect(isSafeHref('//evil.example')).toBe(false);
    expect(isSafeHref('/relative')).toBe(false);
  });
  it('markdown-it output never contains raw html from source', () => {
    expect(renderMarkdownUnsafe('<b onclick=x>y</b>')).toContain('&lt;b onclick=x&gt;');
  });
  it('sanitizeToString strips dangerous markup', () => {
    const out = sanitizeToString('<p onclick="x">a<script>b</script><img src=x></p>');
    expect(out).toBe('<p>a</p>');
  });
});

describe('installTrustedTypesPolicy', () => {
  it('is a no-op without trustedTypes', () => {
    expect(installTrustedTypesPolicy(undefined)).toBe(false);
  });
  it('creates the default policy: sanitises html, rejects script sinks', () => {
    const createPolicy = vi.fn();
    expect(installTrustedTypesPolicy({ createPolicy })).toBe(true);
    expect(createPolicy).toHaveBeenCalledTimes(1);
    const [name, rules] = createPolicy.mock.calls[0]! as [
      string,
      Record<string, (s: string) => string>,
    ];
    expect(name).toBe('default');
    expect(rules.createHTML!('<img src=x onerror=1>hi')).toBe('hi');
    expect(() => rules.createScript!('1')).toThrow();
    expect(() => rules.createScriptURL!('https://x')).toThrow();
  });
});
