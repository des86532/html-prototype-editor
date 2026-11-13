/**
 * 主應用 CSP（規格「主應用 CSP」）。`frame-src` 與 `connect-src` 依部署網域組出。
 * 開發用 vite dev server 需要 inline style / HMR，所以只在 `vite preview`（建置後）套用嚴格版本。
 */
export interface AppCspInput {
  /** 例如 content.localhost:5174 或 protousercontent.net */
  contentBaseDomain: string;
  contentScheme: 'http' | 'https';
  apiOrigin: string;
}

export function buildAppCsp({ contentBaseDomain, contentScheme, apiOrigin }: AppCspInput): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    `frame-src ${contentScheme}://*.${contentBaseDomain}`,
    `connect-src 'self' ${apiOrigin}`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "require-trusted-types-for 'script'",
    'trusted-types default dompurify',
  ].join('; ');
}
