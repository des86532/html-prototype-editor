/**
 * Host → contentKey。
 *
 * contentKey 格式：128-bit 隨機值的 RFC 4648 base32（小寫、無 padding）= 26 個 `[a-z2-7]` 字元。
 * 它是子網域的第一個 label，因此必須是合法 DNS label（≤ 63 字元）；我們接受 26–63 字元，
 * 之後想加長（例如加上校驗碼）不需要改這裡。
 */
export const CONTENT_KEY_RE = /^[a-z2-7]{26,63}$/;

export function isContentKey(value: string): boolean {
  return CONTENT_KEY_RE.test(value);
}

function stripPort(host: string): string {
  return host.replace(/:\d+$/, '');
}

/**
 * 從 `Host` header 取出 contentKey。
 * `baseDomain` 是 `CONTENT_BASE_DOMAIN`（開發為 `content.localhost:5174`，含 port）。
 * Host 必須是 `{key}.{baseDomain}`：只能多一個 label，base domain 必須完全相符，否則回傳 null（404）。
 * baseDomain 沒有 port 時（正式環境）忽略 Host 的 port。
 */
export function contentKeyFromHost(host: string | undefined, baseDomain: string): string | null {
  if (!host) return null;
  const base = baseDomain.toLowerCase();
  const h = (/:\d+$/.test(base) ? host : stripPort(host)).toLowerCase();
  const suffix = `.${base}`;
  if (!h.endsWith(suffix)) return null;
  const label = h.slice(0, -suffix.length);
  return isContentKey(label) ? label : null;
}
