import { describe, expect, it } from 'vitest';
import { contentKeyFromHost } from './resolveVersion.js';
import { normalizeRequestPath } from './paths.js';
import { contentTypeFor, isDocumentPath } from './mime.js';

const KEY = 'abcdefghijklmnopqrstuvwxyz';

describe('contentKeyFromHost', () => {
  const base = 'content.localhost:5174';
  it('extracts the first label when the base domain matches exactly', () => {
    expect(contentKeyFromHost(`${KEY}.${base}`, base)).toBe(KEY);
    expect(contentKeyFromHost(`${KEY.toUpperCase()}.${base.toUpperCase()}`, base)).toBe(KEY);
  });
  it.each([
    undefined,
    '',
    base,
    `${KEY}.${base}.evil.com`,
    `${KEY}.content.localhost:9999`,
    `${KEY}.content.localhost`,
    `x.${KEY}.${base}`,
    `short.${base}`,
    `${KEY.replace('a', '1')}.${base}`,
    `${KEY}.evilcontent.localhost:5174`,
    `${KEY}@${base}`,
  ])('rejects %s', (host) => {
    expect(contentKeyFromHost(host, base)).toBeNull();
  });
  it('ignores the port when the base domain has none', () => {
    expect(contentKeyFromHost(`${KEY}.protousercontent.net:8443`, 'protousercontent.net')).toBe(
      KEY,
    );
    expect(
      contentKeyFromHost(`${KEY}.protousercontent.net.evil`, 'protousercontent.net'),
    ).toBeNull();
  });
});

describe('normalizeRequestPath', () => {
  it('normalizes ordinary paths', () => {
    expect(normalizeRequestPath('/')).toEqual({ path: '', isDir: true });
    expect(normalizeRequestPath('/a/b.html?x=1#y')).toEqual({ path: 'a/b.html', isDir: false });
    expect(normalizeRequestPath('/a//b/./c.css')).toEqual({ path: 'a/b/c.css', isDir: false });
    expect(normalizeRequestPath('/docs/')).toEqual({ path: 'docs', isDir: true });
    expect(normalizeRequestPath('/%E4%B8%AD%E6%96%87.html')).toEqual({
      path: '中文.html',
      isDir: false,
    });
    // NFD → NFC
    expect(normalizeRequestPath('/e\u0301.txt')?.path).toBe('\u00e9.txt');
  });
  it.each([
    '/../etc/passwd',
    '/a/../../b',
    '/a/%2e%2e/b',
    '/%2E%2E/x',
    '/a/..%2fb',
    '/a%00.html',
    '/a\0.html',
    '/a\\b.html',
    '/a%5Cb.html',
    '/a%5cb.html',
    '/%ZZ',
    '/a\nb',
    'index.html',
    '',
  ])('rejects %j', (url) => {
    expect(normalizeRequestPath(url)).toBeNull();
  });
  it('does not treat a leading // as a host', () => {
    expect(normalizeRequestPath('//evil.example/x.html')).toEqual({
      path: 'evil.example/x.html',
      isDir: false,
    });
  });
});

describe('mime by extension only', () => {
  it('maps known extensions', () => {
    expect(contentTypeFor('a/b.HTML')).toBe('text/html; charset=utf-8');
    expect(contentTypeFor('x.svg')).toBe('image/svg+xml');
    expect(contentTypeFor('x.mjs')).toBe('text/javascript; charset=utf-8');
    expect(contentTypeFor('x.woff2')).toBe('font/woff2');
  });
  it('refuses anything outside the whitelist', () => {
    for (const p of ['x.php', 'x.exe', 'x', 'x.html.exe', 'x.xhtml', 'x.xml', '.htaccess'])
      expect(contentTypeFor(p)).toBeNull();
  });
  it('treats html and svg as documents', () => {
    expect(isDocumentPath('a.htm')).toBe(true);
    expect(isDocumentPath('a.svg')).toBe(true);
    expect(isDocumentPath('a.js')).toBe(false);
  });
});
