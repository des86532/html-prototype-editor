/**
 * agent 在匯出模式送來的 `navigateRequest.pageId`（bundle 內相對路徑，已由 agent 正規化）→ payload 中的頁面路徑。
 * 找不到回傳 null（shell 顯示提示，不導航）。
 */
export function resolvePageRequest(pageId: string, pages: readonly string[]): string | null {
  const cleaned = pageId
    .split('#')[0]!
    .split('?')[0]!
    .replace(/^(\.\/)+/, '')
    .replace(/^\/+/, '');
  const candidates = [cleaned];
  try {
    candidates.push(decodeURIComponent(cleaned));
  } catch {
    /* 無效的百分比編碼：只比對原字串 */
  }
  if (cleaned === '' || cleaned.endsWith('/')) candidates.push(`${cleaned}index.html`);
  for (const c of candidates) if (pages.includes(c)) return c;
  return null;
}
