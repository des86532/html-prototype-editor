import { defaultTreeAdapter, html as p5html, parse, serialize } from 'parse5';
import type { DefaultTreeAdapterTypes } from 'parse5';
import { escapeForScript } from './browser.js';
import { EXPORT_WARN_BYTES } from './types.js';
import type { Bundle } from './types.js';

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;

export type ResourceKind = 'script' | 'style' | 'img' | 'font' | 'media' | 'other';

export interface RemoteRef {
  page: string;
  url: string;
  kind: ResourceKind;
}

export interface UnresolvedRef {
  page: string;
  /** 原始參照字串。 */
  ref: string;
  /** 參照出現的檔案（HTML 頁或 CSS 檔）。 */
  from: string;
  reason: 'missing' | 'escapes-root' | 'cycle' | 'depth';
}

export interface InlineReport {
  /** 被轉成 data: URI／內嵌 `<style>`／內嵌 `<script>` 的資源次數。 */
  inlined: number;
  /** 保留原樣的 http(s) 遠端資源（匯出檔的 CSP 會擋下）。 */
  remote: RemoteRef[];
  unresolved: UnresolvedRef[];
  /** 所有輸出頁面的 UTF-8 位元組總和。 */
  totalBytes: number;
  /** 超過 20 MB。 */
  warnLarge: boolean;
}

export interface InlineResult {
  pages: Record<string, string>;
  report: InlineReport;
}

export const MAX_CSS_IMPORT_DEPTH = 8;

const MIME: Record<string, string> = {
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  json: 'application/json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
  mp4: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  vtt: 'text/vtt',
  txt: 'text/plain',
};

function extOf(path: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(path);
  return m ? m[1]!.toLowerCase() : '';
}

function kindFromPath(path: string): ResourceKind {
  const e = extOf(path.split(/[?#]/)[0] ?? '');
  if (['woff', 'woff2', 'ttf', 'otf', 'eot'].includes(e)) return 'font';
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'ico', 'bmp'].includes(e)) return 'img';
  if (['mp4', 'webm', 'ogv', 'mp3', 'wav', 'ogg', 'm4a'].includes(e)) return 'media';
  if (e === 'css') return 'style';
  if (e === 'js' || e === 'mjs') return 'script';
  return 'other';
}

function toBase64(data: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64');
  }
  let s = '';
  for (let i = 0; i < data.length; i += 0x8000) {
    s += String.fromCharCode(...data.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

const decoder = new TextDecoder('utf-8');
const encoder = new TextEncoder();

/* ---------------------------------------------------------------- 路徑 */

type RefClass = 'skip' | 'remote' | 'local';

function classify(raw: string): RefClass {
  const ref = raw.trim();
  if (!ref || ref.startsWith('#')) return 'skip';
  if (/^(https?:)?[/\\]{2}/i.test(ref) || /^https?:/i.test(ref)) return 'remote';
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) return 'skip'; // data:, blob:, about:, javascript:, mailto: …
  return 'local';
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** 解析相對 `base`（bundle 路徑）的參照；逃出根目錄回傳 `null`。 */
export function resolveBundlePath(
  base: string,
  ref: string,
): { path: string; raw: string; fragment: string } | null {
  const cleaned = ref.trim().replace(/\\/g, '/');
  const hash = cleaned.indexOf('#');
  const fragment = hash >= 0 ? cleaned.slice(hash) : '';
  const noFrag = hash >= 0 ? cleaned.slice(0, hash) : cleaned;
  const q = noFrag.indexOf('?');
  const pathPart = q >= 0 ? noFrag.slice(0, q) : noFrag;
  const join = (p: string): string | null => {
    const segs = pathPart.startsWith('/') ? [] : base.split('/').slice(0, -1);
    for (const seg of p.split('/')) {
      if (seg === '' || seg === '.') continue;
      if (seg === '..') {
        if (segs.length === 0) return null;
        segs.pop();
      } else segs.push(seg);
    }
    return segs.join('/');
  };
  const decoded = join(safeDecode(pathPart));
  const raw = join(pathPart);
  if (decoded === null || raw === null) return null;
  return { path: decoded, raw, fragment };
}

/* ---------------------------------------------------------------- context */

interface Ctx {
  bundle: Bundle;
  page: string;
  report: InlineReport;
}

function lookup(ctx: Ctx, base: string, ref: string, from: string) {
  const resolved = resolveBundlePath(base, ref);
  if (!resolved) {
    ctx.report.unresolved.push({ page: ctx.page, ref, from, reason: 'escapes-root' });
    return null;
  }
  const file = ctx.bundle.get(resolved.path) ?? ctx.bundle.get(resolved.raw);
  if (!file) {
    ctx.report.unresolved.push({ page: ctx.page, ref, from, reason: 'missing' });
    return null;
  }
  return {
    file,
    path: ctx.bundle.has(resolved.path) ? resolved.path : resolved.raw,
    fragment: resolved.fragment,
  };
}

function noteRemote(ctx: Ctx, url: string, kind: ResourceKind): void {
  const dup = ctx.report.remote.some((r) => r.page === ctx.page && r.url === url);
  if (!dup) ctx.report.remote.push({ page: ctx.page, url: url.trim(), kind });
}

/** 把本地參照轉成 data: URI；遠端／已是 data: 的回傳 `null`（遠端會登記）；缺檔登記為 unresolved。 */
function toDataUri(ctx: Ctx, base: string, ref: string, kind: ResourceKind): string | null {
  const c = classify(ref);
  if (c === 'skip') return null;
  if (c === 'remote') {
    noteRemote(ctx, ref, kind);
    return null;
  }
  const hit = lookup(ctx, base, ref, base);
  if (!hit) return null;
  const mime = hit.file.mime ?? MIME[extOf(hit.path)] ?? 'application/octet-stream';
  ctx.report.inlined++;
  return `data:${mime};base64,${toBase64(hit.file.data)}${hit.fragment}`;
}

/* ---------------------------------------------------------------- CSS */

/* eslint-disable no-control-regex */
function isIdent(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_\-\\]|[^\u0000-\u007f]/.test(ch);
}

function cssUnescape(s: string): string {
  return s.replace(
    /\\(?:([0-9a-fA-F]{1,6})[ \t\r\n\f]?|([\s\S]))/g,
    (_m, hex?: string, ch?: string) => {
      if (hex) {
        const cp = parseInt(hex, 16);
        return cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)
          ? '\uFFFD'
          : String.fromCodePoint(cp);
      }
      return ch === '\n' ? '' : (ch ?? '');
    },
  );
}

/* eslint-enable no-control-regex */

/** 從 `i`（引號位置）讀一個 CSS 字串，回傳下一個索引與未跳脫內容；未結束回傳 `null`。 */
function readString(css: string, i: number): { end: number; value: string } | null {
  const q = css[i]!;
  let j = i + 1;
  while (j < css.length) {
    const c = css[j]!;
    if (c === '\\') j += 2;
    else if (c === q) return { end: j + 1, value: cssUnescape(css.slice(i + 1, j)) };
    else if (c === '\n') return null;
    else j++;
  }
  return null;
}

/** 解析 `url(...)`（`i` 指向 `u`）；格式不合回傳 `null`。 */
function readUrl(css: string, i: number): { end: number; value: string } | null {
  if (!/^url\(/i.test(css.slice(i, i + 4))) return null;
  let j = i + 4;
  while (j < css.length && /\s/.test(css[j]!)) j++;
  const c = css[j];
  if (c === '"' || c === "'") {
    const s = readString(css, j);
    if (!s) return null;
    let k = s.end;
    while (k < css.length && /\s/.test(css[k]!)) k++;
    return css[k] === ')' ? { end: k + 1, value: s.value } : null;
  }
  const start = j;
  while (j < css.length && css[j] !== ')') {
    if (css[j] === '\\') j++;
    else if (/["'(]/.test(css[j]!)) return null;
    j++;
  }
  if (j >= css.length) return null;
  return { end: j + 1, value: cssUnescape(css.slice(start, j).trim()) };
}

function skipComment(css: string, i: number): number {
  const e = css.indexOf('*/', i + 2);
  return e < 0 ? css.length : e + 2;
}

/**
 * 轉寫 CSS 中所有 `url()` 與 `@import`（遞迴，有循環與深度保護）。
 * `cssPath` 是此 CSS 所在的 bundle 路徑（內嵌 `<style>` 則是頁面路徑），相對參照以它為基準。
 * 只做字串掃描，不會執行任何東西。
 */
function processCss(css: string, cssPath: string, ctx: Ctx, stack: readonly string[]): string {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const c = css[i]!;
    if (c === '/' && css[i + 1] === '*') {
      const e = skipComment(css, i);
      out += css.slice(i, e);
      i = e;
    } else if (c === '"' || c === "'") {
      const s = readString(css, i);
      const e = s ? s.end : i + 1;
      out += css.slice(i, e);
      i = e;
    } else if (c === '@' && /^@import/i.test(css.slice(i, i + 7)) && !isIdent(css[i + 7])) {
      const r = handleImport(css, i, cssPath, ctx, stack);
      out += r.text;
      i = r.end;
    } else if ((c === 'u' || c === 'U') && !isIdent(css[i - 1])) {
      const u = readUrl(css, i);
      if (u) {
        const uri = toDataUri(ctx, cssPath, u.value, kindFromPath(u.value));
        out += uri ? `url("${uri}")` : css.slice(i, u.end);
        i = u.end;
      } else {
        out += c;
        i++;
      }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function handleImport(
  css: string,
  start: number,
  cssPath: string,
  ctx: Ctx,
  stack: readonly string[],
): { text: string; end: number } {
  let j = start + 7;
  while (j < css.length && /\s/.test(css[j]!)) j++;
  let target: { end: number; value: string } | null = null;
  if (css[j] === '"' || css[j] === "'") target = readString(css, j);
  else target = readUrl(css, j);
  // 找語句結尾 `;`（跳過字串與括號），用來取得 media query。
  let k = target ? target.end : j;
  let depth = 0;
  while (k < css.length) {
    const ch = css[k]!;
    if (ch === '"' || ch === "'") {
      const s = readString(css, k);
      k = s ? s.end : k + 1;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ';' && depth === 0) break;
    else if (ch === '}' && depth === 0) {
      // 缺少 `;`：停在 `}` 前
      return finish(k, css.slice(start, k));
    }
    k++;
  }
  return finish(Math.min(k + 1, css.length), css.slice(start, Math.min(k + 1, css.length)));

  function finish(end: number, original: string): { text: string; end: number } {
    if (!target) return { text: original, end };
    const cls = classify(target.value);
    if (cls === 'remote') {
      noteRemote(ctx, target.value, 'style');
      return { text: original, end };
    }
    if (cls === 'skip') return { text: original, end };
    const resolved = resolveBundlePath(cssPath, target.value);
    if (!resolved) {
      ctx.report.unresolved.push({
        page: ctx.page,
        ref: target.value,
        from: cssPath,
        reason: 'escapes-root',
      });
      return { text: original, end };
    }
    const path = ctx.bundle.has(resolved.path) ? resolved.path : resolved.raw;
    const file = ctx.bundle.get(path);
    if (!file) {
      ctx.report.unresolved.push({
        page: ctx.page,
        ref: target.value,
        from: cssPath,
        reason: 'missing',
      });
      return { text: original, end };
    }
    if (stack.includes(path)) {
      ctx.report.unresolved.push({
        page: ctx.page,
        ref: target.value,
        from: cssPath,
        reason: 'cycle',
      });
      return { text: '/* hpe: cyclic @import skipped */', end };
    }
    if (stack.length >= MAX_CSS_IMPORT_DEPTH) {
      ctx.report.unresolved.push({
        page: ctx.page,
        ref: target.value,
        from: cssPath,
        reason: 'depth',
      });
      return { text: '/* hpe: @import depth limit */', end };
    }
    ctx.report.inlined++;
    const inner = processCss(decoder.decode(file.data), path, ctx, [...stack, path]);
    const afterUrl = css.slice(target.end, end).replace(/;\s*$/, '').trim();
    // layer()/supports() 條件無法無損轉成 @media，只保留 media query 的情形。
    const cond = /\b(layer|supports)\b/i.test(afterUrl) ? '' : afterUrl;
    return { text: cond ? `@media ${cond}{\n${inner}\n}` : `${inner}\n`, end };
  }
}

/** 內嵌到 `<style>` 時避免提前結束。 */
function escapeForStyle(css: string): string {
  return css.replace(/<\/(style)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
}

/* ---------------------------------------------------------------- srcset */

export function parseSrcset(value: string): { url: string; descriptor: string }[] {
  const out: { url: string; descriptor: string }[] = [];
  let i = 0;
  const n = value.length;
  while (i < n) {
    while (i < n && /[\s,]/.test(value[i]!)) i++;
    if (i >= n) break;
    const s = i;
    while (i < n && !/\s/.test(value[i]!)) i++;
    let url = value.slice(s, i);
    let descriptor = '';
    if (url.endsWith(',')) {
      url = url.replace(/,+$/, '');
    } else {
      const ds = i;
      let paren = 0;
      while (i < n) {
        const ch = value[i]!;
        if (ch === '(') paren++;
        else if (ch === ')') paren = Math.max(0, paren - 1);
        else if (ch === ',' && paren === 0) break;
        i++;
      }
      descriptor = value.slice(ds, i).trim();
    }
    if (url) out.push({ url, descriptor });
  }
  return out;
}

/* ---------------------------------------------------------------- HTML */

function isElement(n: Node): n is Element {
  return 'tagName' in n;
}

function getAttr(el: Element, name: string): string | undefined {
  return el.attrs.find((a) => a.name === name)?.value;
}

function setAttr(el: Element, name: string, value: string): void {
  const a = el.attrs.find((x) => x.name === name);
  if (a) a.value = value;
  else el.attrs.push({ name, value });
}

function removeAttrs(el: Element, ...names: string[]): void {
  el.attrs = el.attrs.filter((a) => !names.includes(a.name));
}

function replaceText(el: Element, text: string): void {
  for (const child of [...el.childNodes]) defaultTreeAdapter.detachNode(child);
  if (text) defaultTreeAdapter.insertText(el, text);
}

function textOf(el: Element): string {
  return el.childNodes.map((c) => ('value' in c && c.nodeName === '#text' ? c.value : '')).join('');
}

function rewriteRef(ctx: Ctx, el: Element, attr: string, kind: ResourceKind): void {
  const v = getAttr(el, attr);
  if (v === undefined) return;
  const uri = toDataUri(ctx, ctx.page, v, kind);
  if (uri) setAttr(el, attr, uri);
}

function rewriteSrcset(ctx: Ctx, el: Element): void {
  const v = getAttr(el, 'srcset');
  if (v === undefined) return;
  const parts = parseSrcset(v).map(({ url, descriptor }) => {
    const uri = toDataUri(ctx, ctx.page, url, 'img') ?? url;
    return descriptor ? `${uri} ${descriptor}` : uri;
  });
  setAttr(el, 'srcset', parts.join(', '));
}

const ICON_RELS = new Set([
  'icon',
  'shortcut',
  'apple-touch-icon',
  'apple-touch-icon-precomposed',
  'mask-icon',
]);
const LINK_DROP_ATTRS = [
  'rel',
  'href',
  'integrity',
  'crossorigin',
  'type',
  'as',
  'referrerpolicy',
  'hreflang',
  'sizes',
  'fetchpriority',
];

function handleLink(ctx: Ctx, el: Element): void {
  const href = getAttr(el, 'href');
  if (href === undefined) return;
  const rels = (getAttr(el, 'rel') ?? '').toLowerCase().split(/\s+/);
  if (rels.includes('stylesheet')) {
    const cls = classify(href);
    if (cls === 'remote') return noteRemote(ctx, href, 'style');
    if (cls === 'skip') return;
    const hit = lookup(ctx, ctx.page, href, ctx.page);
    if (!hit || !el.parentNode) return;
    ctx.report.inlined++;
    const css = processCss(decoder.decode(hit.file.data), hit.path, ctx, [hit.path]);
    const style = defaultTreeAdapter.createElement('style', p5html.NS.HTML, []);
    for (const a of el.attrs) if (!LINK_DROP_ATTRS.includes(a.name)) style.attrs.push({ ...a });
    defaultTreeAdapter.insertText(style, escapeForStyle(css));
    defaultTreeAdapter.insertBefore(el.parentNode, style, el);
    defaultTreeAdapter.detachNode(el);
  } else if (rels.some((r) => ICON_RELS.has(r))) {
    rewriteRef(ctx, el, 'href', 'img');
  }
}

interface ScriptState {
  deferred: Element[];
}

function handleScript(ctx: Ctx, el: Element, state: ScriptState): void {
  const src = getAttr(el, 'src');
  if (src === undefined) return;
  const cls = classify(src);
  if (cls === 'remote') return noteRemote(ctx, src, 'script');
  if (cls === 'skip') return;
  const hit = lookup(ctx, ctx.page, src, ctx.page);
  if (!hit) return;
  ctx.report.inlined++;
  const isModule = (getAttr(el, 'type') ?? '').toLowerCase() === 'module';
  const wasDeferred = getAttr(el, 'defer') !== undefined && !isModule;
  removeAttrs(el, 'src', 'integrity', 'crossorigin', 'defer', 'async');
  replaceText(el, escapeForScript(decoder.decode(hit.file.data)));
  if (wasDeferred) state.deferred.push(el);
}

function processStyleAttr(ctx: Ctx, el: Element): void {
  const v = getAttr(el, 'style');
  if (v !== undefined && /url\(|@import/i.test(v))
    setAttr(el, 'style', processCss(v, ctx.page, ctx, []));
}

function handleElement(ctx: Ctx, el: Element, state: ScriptState): void {
  processStyleAttr(ctx, el);
  const parentTag = el.parentNode && isElement(el.parentNode) ? el.parentNode.tagName : '';
  switch (el.tagName) {
    case 'link':
      return handleLink(ctx, el);
    case 'script':
      return handleScript(ctx, el, state);
    case 'style': {
      const css = textOf(el);
      if (/url\(|@import/i.test(css))
        replaceText(el, escapeForStyle(processCss(css, ctx.page, ctx, [])));
      return;
    }
    case 'img':
      rewriteRef(ctx, el, 'src', 'img');
      return rewriteSrcset(ctx, el);
    case 'source': {
      const kind = parentTag === 'picture' ? 'img' : 'media';
      rewriteRef(ctx, el, 'src', kind);
      return rewriteSrcset(ctx, el);
    }
    case 'video':
      rewriteRef(ctx, el, 'src', 'media');
      return rewriteRef(ctx, el, 'poster', 'img');
    case 'audio':
      return rewriteRef(ctx, el, 'src', 'media');
    case 'track':
      return rewriteRef(ctx, el, 'src', 'other');
    case 'embed':
      return rewriteRef(ctx, el, 'src', 'other');
    case 'object':
      return rewriteRef(ctx, el, 'data', 'other');
    case 'input':
      if ((getAttr(el, 'type') ?? '').toLowerCase() === 'image') rewriteRef(ctx, el, 'src', 'img');
      return;
    case 'image':
    case 'use':
    case 'feImage':
      // inline SVG：`href` 與 `xlink:href`（parse5 以 prefix 區分，name 同為 href）
      for (const a of el.attrs) {
        if (a.name !== 'href') continue;
        const uri = toDataUri(ctx, ctx.page, a.value, 'img');
        if (uri) a.value = uri;
      }
      return;
    case 'body':
    case 'table':
    case 'tr':
    case 'td':
    case 'th':
      return rewriteRef(ctx, el, 'background', 'img');
    default:
  }
}

function findBody(root: ParentNode): Element | null {
  for (const c of root.childNodes) {
    if (!isElement(c)) continue;
    if (c.tagName === 'body') return c;
    const r = findBody(c);
    if (r) return r;
  }
  return null;
}

function walk(ctx: Ctx, node: ParentNode, state: ScriptState): void {
  for (const child of [...node.childNodes]) {
    if (!isElement(child)) continue;
    handleElement(ctx, child, state);
    walk(ctx, child, state);
    if (child.tagName === 'template')
      walk(ctx, (child as DefaultTreeAdapterTypes.Template).content, state);
  }
}

/** 單一頁面：回傳序列化後的 HTML。 */
function inlinePage(ctx: Ctx, source: string): string {
  const doc = parse(source);
  const state: ScriptState = { deferred: [] };
  walk(ctx, doc, state);
  if (state.deferred.length > 0) {
    // 原本 defer 的腳本在 parse 結束後才執行；內嵌後移到 body 尾端以維持順序與 DOM 可用性。
    const body = findBody(doc);
    if (body) {
      for (const s of state.deferred) {
        defaultTreeAdapter.detachNode(s);
        defaultTreeAdapter.appendChild(body, s);
      }
    }
  }
  return serialize(doc);
}

export interface InlineAssetsOptions {
  bundle: Bundle;
  /** 要處理的頁面路徑；缺省為 bundle 內所有 `.html`／`.htm`。 */
  pages?: readonly string[];
}

/**
 * 把每個頁面引用的本地資源改成 `data:` URI／內嵌 `<style>`／內嵌 `<script>`。
 * http(s) 遠端資源保持原樣並列入 `report.remote`（匯出 shell 的 CSP 會擋下）。
 * 多頁連結（`<a href="pricing.html">`）不會被改寫，由 shell 的 agent 攔截。
 */
export function inlineAssets(opts: InlineAssetsOptions): InlineResult {
  const report: InlineReport = {
    inlined: 0,
    remote: [],
    unresolved: [],
    totalBytes: 0,
    warnLarge: false,
  };
  const pagePaths = opts.pages ?? [...opts.bundle.keys()].filter((p) => /\.html?$/i.test(p));
  const pages: Record<string, string> = {};
  for (const page of pagePaths) {
    const file = opts.bundle.get(page);
    if (!file) {
      report.unresolved.push({ page, ref: page, from: '(export)', reason: 'missing' });
      continue;
    }
    const out = inlinePage({ bundle: opts.bundle, page, report }, decoder.decode(file.data));
    pages[page] = out;
    report.totalBytes += encoder.encode(out).length;
  }
  report.warnLarge = report.totalBytes > EXPORT_WARN_BYTES;
  return { pages, report };
}
