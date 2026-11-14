import { describe, expect, it } from 'vitest';
import { analyzeBundle, recomputeBlocked } from './analyze.js';
import { detectEntry } from './entryDetect.js';
import type { BundleFile } from './validateEntries.js';

const f = (path: string, text: string): BundleFile => ({ path, data: Buffer.from(text) });

const PAGE = `<!doctype html><html><head>
<title>  我的 首頁 </title>
<base href="/x/">
<meta http-equiv="Refresh" content="5;url=https://evil.example/">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
<link rel="stylesheet" href="local.css">
<link rel="canonical" href="https://example.com/">
<script src="https://cdn.jsdelivr.net/npm/alpinejs"></script>
<script src="app.js"></script>
<script>navigator.serviceWorker.register('/sw.js')</script>
<style>@import url("https://evil.example/a.css"); .x{background:url(https://tracker.example/p.png)}</style>
</head><body style="background:url('//cdn.example/bg.jpg')">
<img src="https://img.example/a.png" srcset="https://img.example/b.png 2x, local.png 1x">
<video src="//media.example/v.mp4" poster="p.png"></video>
<iframe src="https://frame.example/"></iframe><iframe srcdoc="<p>x</p>"></iframe>
<form action="/x"><input type="password"><input type=PASSWORD></form>
<template><img src="https://tpl.example/t.png"></template>
</body></html>`;

describe('analyzeBundle', () => {
  const { report, pages } = analyzeBundle(
    [
      f('index.html', PAGE),
      f('sub/page.html', '<title>子頁</title><p>x</p>'),
      f('local.css', '@font-face{src:url(https://fonts.gstatic.com/s/inter.woff2)}'),
      f('app.js', 'console.log(1)'),
    ],
    [],
  );

  it('頁面清單與標題（parse5）', () => {
    expect(pages).toEqual([
      { path: 'index.html', title: '我的 首頁' },
      { path: 'sub/page.html', title: '子頁' },
    ]);
  });

  it('script 與計數', () => {
    expect(report.scripts.inline).toBe(1);
    expect(report.scripts.external).toEqual(['https://cdn.jsdelivr.net/npm/alpinejs']);
    expect(report.forms).toBe(1);
    expect(report.passwordInputs).toBe(2);
    expect(report.metaRefresh).toBe(true);
    expect(report.baseTag).toBe(true);
    expect(report.serviceWorkerRegistration).toBe(true);
    expect(report.iframes).toEqual(['https://frame.example/', 'srcdoc']);
  });

  it('外部資源分類，預設全部封鎖（canonical 不算資源）', () => {
    const byUrl = Object.fromEntries(report.externalResources.map((r) => [r.url, r]));
    expect(byUrl['https://fonts.googleapis.com/css2?family=Inter']?.kind).toBe('style');
    expect(byUrl['https://cdn.jsdelivr.net/npm/alpinejs']?.kind).toBe('script');
    expect(byUrl['https://evil.example/a.css']?.kind).toBe('style');
    expect(byUrl['https://tracker.example/p.png']?.kind).toBe('img');
    expect(byUrl['https://cdn.example/bg.jpg']?.kind).toBe('img');
    expect(byUrl['https://img.example/b.png']?.kind).toBe('img');
    expect(byUrl['https://media.example/v.mp4']?.kind).toBe('media');
    expect(byUrl['https://fonts.gstatic.com/s/inter.woff2']?.kind).toBe('font');
    expect(byUrl['https://tpl.example/t.png']?.kind).toBe('img');
    expect(byUrl['https://example.com/']).toBeUndefined();
    expect(report.externalResources.every((r) => r.blocked)).toBe(true);
  });

  it('警告為繁體中文', () => {
    expect(report.warnings.some((w) => w.includes('外部資源會被封鎖'))).toBe(true);
    expect(report.warnings.some((w) => w.includes('密碼欄位'))).toBe(true);
    expect(report.warnings.some((w) => w.includes('service worker'))).toBe(true);
  });

  it('CDN allowlist 只開放 script/style/font；img/media 永遠被擋', () => {
    const next = recomputeBlocked(report, [
      'https://cdn.jsdelivr.net',
      'https://fonts.googleapis.com',
      'https://fonts.gstatic.com',
      'https://img.example',
    ]);
    const blocked = (url: string) => next.externalResources.find((r) => r.url === url)?.blocked;
    expect(blocked('https://cdn.jsdelivr.net/npm/alpinejs')).toBe(false);
    expect(blocked('https://fonts.googleapis.com/css2?family=Inter')).toBe(false);
    expect(blocked('https://fonts.gstatic.com/s/inter.woff2')).toBe(false);
    expect(blocked('https://img.example/a.png')).toBe(true);
    expect(blocked('https://evil.example/a.css')).toBe(true);
    expect(next.warnings).not.toEqual(report.warnings);
  });

  it('沒有任何外部資源時沒有封鎖警告', () => {
    const clean = analyzeBundle([f('index.html', '<title>x</title><img src="a.png">')]);
    expect(clean.report.externalResources).toEqual([]);
    expect(clean.report.warnings).toEqual([]);
  });
});

describe('detectEntry', () => {
  const pages = (...p: string[]) => p.map((path) => ({ path, title: null }));

  it('優先 index.html', () => {
    expect(detectEntry(pages('a.html', 'index.html'))).toEqual({
      status: 'ready',
      entryPage: 'index.html',
      candidates: null,
    });
  });
  it('只有一個 html 就用它', () => {
    expect(detectEntry(pages('home.html')).entryPage).toBe('home.html');
  });
  it('多個且沒有 index → processing + 候選', () => {
    expect(detectEntry(pages('a.html', 'b.html'))).toEqual({
      status: 'processing',
      entryPage: '',
      candidates: ['a.html', 'b.html'],
    });
  });
  it('明確指定入口（必須存在）', () => {
    expect(detectEntry(pages('a.html', 'b.html'), 'b.html').entryPage).toBe('b.html');
    expect(() => detectEntry(pages('a.html'), 'nope.html')).toThrow(/entryPage/);
  });
});
