import { parse } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';
import type { PageInfo, SecurityReport } from '@hpe/shared';
import { extensionOf, isPagePath, type BundleFile } from './validateEntries.js';

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];
type ExternalKind = SecurityReport['externalResources'][number]['kind'];

/** CSP 中有開放 allowlisted CDN 的資源類型（其餘種類永遠被封鎖，見規格 content server CSP）。 */
const ALLOWLISTABLE_KINDS: ReadonlySet<ExternalKind> = new Set(['script', 'style', 'font']);

const SW_REGISTER_RE = /navigator\s*\.\s*serviceWorker\s*\.\s*register\b/;
const CSS_URL_RE = /url\(\s*(?:'([^']*)'|"([^"]*)"|([^'")\s][^)]*?))\s*\)/gi;
const CSS_IMPORT_RE = /@import\s+(?:url\(\s*)?(?:'([^']*)'|"([^"]*)")/gi;
const MAX_SCAN_BYTES = 5 * 1024 * 1024;

/** 外部 URL：http(s):// 或 protocol-relative `//host`。回傳正規化的絕對 URL，否則 null。 */
export function externalUrl(raw: string): string | null {
  const v = raw.trim();
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith('//')) return `https:${v}`;
  return null;
}

export function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null;
  }
}

export function isBlocked(
  url: string,
  kind: ExternalKind,
  cdnAllowlist: readonly string[],
): boolean {
  if (!ALLOWLISTABLE_KINDS.has(kind)) return true;
  const origin = originOf(url);
  return origin === null || !cdnAllowlist.includes(origin);
}

function kindFromExtension(url: string): ExternalKind {
  let pathname = url;
  try {
    pathname = new URL(url).pathname;
  } catch {
    /* keep raw */
  }
  const ext = extensionOf(pathname);
  if (['woff', 'woff2', 'ttf', 'otf'].includes(ext)) return 'font';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'ico'].includes(ext)) return 'img';
  if (['mp4', 'webm', 'mp3'].includes(ext)) return 'media';
  if (ext === 'css') return 'style';
  if (ext === 'js' || ext === 'mjs') return 'script';
  return 'other';
}

const FETCHING_RELS = new Set([
  'stylesheet',
  'icon',
  'apple-touch-icon',
  'preload',
  'modulepreload',
  'prefetch',
  'preconnect',
  'dns-prefetch',
  'manifest',
]);

/** 只有會觸發請求的 rel 才算資源（canonical、alternate 等不算）；回傳 null 代表忽略。 */
function relKind(rel: string, as: string | undefined): ExternalKind | null {
  const tokens = rel.toLowerCase().split(/\s+/);
  if (!tokens.some((t) => FETCHING_RELS.has(t))) return null;
  if (tokens.includes('stylesheet')) return 'style';
  if (tokens.includes('icon') || tokens.includes('apple-touch-icon')) return 'img';
  if (tokens.includes('preload') || tokens.includes('modulepreload')) {
    if (tokens.includes('modulepreload') || as === 'script') return 'script';
    if (as === 'style') return 'style';
    if (as === 'font') return 'font';
    if (as === 'image') return 'img';
    if (as === 'video' || as === 'audio') return 'media';
  }
  return 'other';
}

function srcsetUrls(srcset: string): string[] {
  return srcset
    .split(',')
    .map((part) => part.trim().split(/\s+/)[0] ?? '')
    .filter(Boolean);
}

interface Collector {
  inlineScripts: number;
  externalScripts: Set<string>;
  resources: Map<string, ExternalKind>;
  forms: number;
  passwordInputs: number;
  iframes: string[];
  metaRefresh: boolean;
  baseTag: boolean;
  serviceWorker: boolean;
}

function addResource(c: Collector, raw: string | undefined, kind: ExternalKind): void {
  if (!raw) return;
  const url = externalUrl(raw);
  if (!url) return;
  const key = `${kind}\n${url}`;
  if (!c.resources.has(key)) c.resources.set(key, kind);
}

function scanCss(c: Collector, css: string): void {
  for (const m of css.matchAll(CSS_IMPORT_RE)) addResource(c, m[1] ?? m[2], 'style');
  for (const m of css.matchAll(CSS_URL_RE)) {
    const raw = m[1] ?? m[2] ?? m[3];
    const url = raw ? externalUrl(raw) : null;
    if (url) addResource(c, url, kindFromExtension(url));
  }
}

function attr(el: Element, name: string): string | undefined {
  return el.attrs.find((a) => a.name === name)?.value;
}

function textOf(el: Element): string {
  let out = '';
  for (const child of el.childNodes) {
    if (child.nodeName === '#text') out += (child as unknown as { value: string }).value;
  }
  return out;
}

function visitElement(c: Collector, el: Element, parentTag: string | undefined): void {
  const tag = el.tagName;
  const style = attr(el, 'style');
  if (style) scanCss(c, style);
  switch (tag) {
    case 'script': {
      const src = attr(el, 'src');
      if (src !== undefined) {
        const url = externalUrl(src);
        if (url) {
          c.externalScripts.add(url);
          addResource(c, url, 'script');
        }
      } else {
        c.inlineScripts += 1;
        if (SW_REGISTER_RE.test(textOf(el))) c.serviceWorker = true;
      }
      break;
    }
    case 'style':
      scanCss(c, textOf(el));
      break;
    case 'link': {
      const kind = relKind(attr(el, 'rel') ?? '', attr(el, 'as')?.toLowerCase());
      if (kind) addResource(c, attr(el, 'href'), kind);
      break;
    }
    case 'img':
      addResource(c, attr(el, 'src'), 'img');
      for (const u of srcsetUrls(attr(el, 'srcset') ?? '')) addResource(c, u, 'img');
      break;
    case 'source': {
      const kind: ExternalKind = parentTag === 'picture' ? 'img' : 'media';
      addResource(c, attr(el, 'src'), kind);
      for (const u of srcsetUrls(attr(el, 'srcset') ?? '')) addResource(c, u, kind);
      break;
    }
    case 'video':
      addResource(c, attr(el, 'src'), 'media');
      addResource(c, attr(el, 'poster'), 'img');
      break;
    case 'audio':
    case 'track':
      addResource(c, attr(el, 'src'), 'media');
      break;
    case 'embed':
      addResource(c, attr(el, 'src'), 'other');
      break;
    case 'object':
      addResource(c, attr(el, 'data'), 'other');
      break;
    case 'input':
      if (attr(el, 'type')?.toLowerCase() === 'password') c.passwordInputs += 1;
      if (attr(el, 'type')?.toLowerCase() === 'image') addResource(c, attr(el, 'src'), 'img');
      break;
    case 'form':
      c.forms += 1;
      break;
    case 'iframe':
      c.iframes.push(attr(el, 'src') ?? 'srcdoc');
      break;
    case 'base':
      c.baseTag = true;
      break;
    case 'meta':
      if (attr(el, 'http-equiv')?.toLowerCase() === 'refresh') c.metaRefresh = true;
      break;
  }
}

function walk(c: Collector, root: Node): { title: string | null } {
  let title: string | null = null;
  const stack: { node: Node; parentTag: string | undefined }[] = [
    { node: root, parentTag: undefined },
  ];
  while (stack.length > 0) {
    const { node, parentTag } = stack.pop()!;
    let tag = parentTag;
    if ('tagName' in node) {
      const el = node as Element;
      visitElement(c, el, parentTag);
      if (el.tagName === 'title' && title === null) title = textOf(el).replace(/\s+/g, ' ').trim();
      tag = el.tagName;
      const content = (el as unknown as { content?: Node }).content;
      if (content) stack.push({ node: content, parentTag: tag });
    }
    const children = (node as { childNodes?: Node[] }).childNodes;
    if (children) {
      for (let i = children.length - 1; i >= 0; i -= 1) {
        stack.push({ node: children[i]!, parentTag: tag });
      }
    }
  }
  return { title: title === '' ? null : title };
}

export interface AnalysisResult {
  report: SecurityReport;
  pages: PageInfo[];
}

/** 掃描 bundle 內所有 HTML 頁面（以及 CSS／JS 檔）並產生 SecurityReport 與頁面清單。 */
export function analyzeBundle(
  files: readonly BundleFile[],
  cdnAllowlist: readonly string[] = [],
): AnalysisResult {
  const c: Collector = {
    inlineScripts: 0,
    externalScripts: new Set(),
    resources: new Map(),
    forms: 0,
    passwordInputs: 0,
    iframes: [],
    metaRefresh: false,
    baseTag: false,
    serviceWorker: false,
  };
  const pages: PageInfo[] = [];

  for (const file of files) {
    const ext = extensionOf(file.path);
    if (isPagePath(file.path)) {
      const doc = parse(file.data.toString('utf8'));
      const { title } = walk(c, doc as unknown as Node);
      pages.push({ path: file.path, title });
    } else if (file.data.length <= MAX_SCAN_BYTES) {
      if (ext === 'css') scanCss(c, file.data.toString('utf8'));
      else if ((ext === 'js' || ext === 'mjs') && SW_REGISTER_RE.test(file.data.toString('utf8'))) {
        c.serviceWorker = true;
      }
    }
  }
  pages.sort((a, b) => a.path.localeCompare(b.path));

  const externalResources = [...c.resources.entries()].map(([key, kind]) => {
    const url = key.slice(key.indexOf('\n') + 1);
    return { url, kind, blocked: isBlocked(url, kind, cdnAllowlist) };
  });

  const report: SecurityReport = {
    scripts: { inline: c.inlineScripts, external: [...c.externalScripts] },
    externalResources,
    forms: c.forms,
    passwordInputs: c.passwordInputs,
    iframes: c.iframes,
    metaRefresh: c.metaRefresh,
    baseTag: c.baseTag,
    serviceWorkerRegistration: c.serviceWorker,
    warnings: [],
  };
  report.warnings = buildWarnings(report);
  return { report, pages };
}

/** 依新的 CDN allowlist 重新計算 blocked 與警告，不需重新讀取檔案。 */
export function recomputeBlocked(
  report: SecurityReport,
  cdnAllowlist: readonly string[],
): SecurityReport {
  const next: SecurityReport = {
    ...report,
    externalResources: report.externalResources.map((r) => ({
      ...r,
      blocked: isBlocked(r.url, r.kind, cdnAllowlist),
    })),
  };
  next.warnings = buildWarnings(next);
  return next;
}

export function buildWarnings(r: SecurityReport): string[] {
  const w: string[] = [];
  const blocked = r.externalResources.filter((x) => x.blocked);
  if (blocked.length > 0) {
    const origins = [...new Set(blocked.map((x) => originOf(x.url) ?? x.url))];
    w.push(
      `有 ${blocked.length} 個外部資源會被封鎖（嚴格離線模式）：${origins.slice(0, 5).join('、')}${origins.length > 5 ? ' 等' : ''}。可在 CDN 白名單中開放 script／樣式／字型。`,
    );
  }
  if (r.scripts.inline > 0 || r.scripts.external.length > 0) {
    w.push(
      `包含 ${r.scripts.inline} 段內嵌 script 與 ${r.scripts.external.length} 個外部 script，將在隔離沙箱內執行。`,
    );
  }
  if (r.forms > 0) w.push(`包含 ${r.forms} 個表單：預覽模式不會送出表單。`);
  if (r.passwordInputs > 0)
    w.push(`包含 ${r.passwordInputs} 個密碼欄位：請勿在預覽中輸入真實密碼。`);
  if (r.iframes.length > 0) w.push(`包含 ${r.iframes.length} 個 iframe：外部頁面會被封鎖。`);
  if (r.metaRefresh) w.push('包含 meta refresh：可能導向外部頁面，離開預覽範圍時會被遮罩。');
  if (r.baseTag) w.push('包含 <base> 標籤：會被 CSP 封鎖，相對路徑可能失效。');
  if (r.serviceWorkerRegistration) w.push('偵測到 service worker 註冊：沙箱內無法使用。');
  return w;
}
