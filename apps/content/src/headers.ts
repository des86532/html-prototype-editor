/**
 * content server 的回應 header（規格「2. 沙箱安全規格 → content server 回應 header（HTML）」）。
 */

export interface HeaderOptions {
  /** `frame-ancestors` 只允許這個 origin（APP_ORIGIN） */
  appOrigin: string;
  /** CSP violation 報告端點（`Reporting-Endpoints: csp-endpoint="…"`）；沒有就不送 Reporting-Endpoints */
  cspReportUrl?: string | undefined;
}

export type HeaderMap = Record<string, string>;

const ORIGIN_RE = /^https?:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/;

/**
 * 只接受單純的 origin（scheme://host[:port]）。這些值最終會被串進 CSP，
 * 任何含空白、`;`、`,`、引號、萬用字元的值都會讓 CSP 被注入額外指令，所以直接丟掉。
 */
export function sanitizeOrigins(origins: readonly string[]): string[] {
  const out = new Set<string>();
  for (const o of origins) {
    const v = o.trim().toLowerCase();
    if (ORIGIN_RE.test(v)) out.add(v);
  }
  return [...out];
}

export function buildContentCsp(cdnAllowlist: readonly string[], appOrigin: string): string {
  const cdns = sanitizeOrigins(cdnAllowlist);
  const ancestors = sanitizeOrigins([appOrigin]);
  if (ancestors.length === 0)
    throw new Error(`invalid APP_ORIGIN for frame-ancestors: ${appOrigin}`);
  const list = (...base: string[]) => [...base, ...cdns].join(' ');
  return [
    'sandbox allow-scripts',
    "default-src 'none'",
    `script-src ${list("'self'", "'unsafe-inline'", "'unsafe-eval'")}`,
    `style-src ${list("'self'", "'unsafe-inline'")}`,
    "img-src 'self' data: blob:",
    `font-src ${list("'self'", 'data:')}`,
    "media-src 'self' data: blob:",
    "connect-src 'self'",
    "frame-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    `frame-ancestors ${ancestors[0]}`,
    'report-to csp-endpoint',
  ].join('; ');
}

export const PERMISSIONS_POLICY =
  'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), clipboard-read=(), display-capture=()';

/** 所有 bundle 回應共用的 header。 */
function commonHeaders(opts: HeaderOptions): HeaderMap {
  const h: HeaderMap = {
    'Permissions-Policy': PERMISSIONS_POLICY,
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=300',
    // frame 是 opaque origin，fetch／module script／字型都是跨 origin 請求，需要 CORS。
    // 知道 contentKey 的人本來就能直接 GET，所以 `*` 不會多洩漏什麼（規格）。
    'Access-Control-Allow-Origin': '*',
  };
  if (opts.cspReportUrl) h['Reporting-Endpoints'] = `csp-endpoint="${opts.cspReportUrl}"`;
  return h;
}

/**
 * HTML 與 SVG（會被當成文件執行 script 的類型）的完整 header。
 * `Cross-Origin-Resource-Policy: same-site` 只加在「文件」上：子資源（img、script、css）的請求者是 opaque origin，
 * 對 CORP 來說永遠不是 same-site，加在子資源上會讓 prototype 自己的圖片和 script 載入失敗。
 */
export function documentHeaders(
  contentType: string,
  cdnAllowlist: readonly string[],
  opts: HeaderOptions,
): HeaderMap {
  return {
    'Content-Type': contentType,
    'Content-Security-Policy': buildContentCsp(cdnAllowlist, opts.appOrigin),
    'Cross-Origin-Resource-Policy': 'same-site',
    ...commonHeaders(opts),
  };
}

/** 其他靜態資源（js/css/圖片/字型/媒體/json…）。 */
export function assetHeaders(contentType: string, opts: HeaderOptions): HeaderMap {
  return { 'Content-Type': contentType, ...commonHeaders(opts) };
}

/** 404／405 等錯誤：空 body，不洩漏任何資訊。 */
export function errorHeaders(): HeaderMap {
  return {
    'Content-Length': '0',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };
}
