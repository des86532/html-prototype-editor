import { AppError, type PageInfo } from '@hpe/shared';

export type EntryDecision =
  | { status: 'ready'; entryPage: string; candidates: null }
  | { status: 'processing'; entryPage: ''; candidates: string[] };

/**
 * 決定入口頁：指定的 entryPage（必須是 bundle 內的 HTML）→ index.html／index.htm →
 * 只有一個 HTML → 否則回報候選清單，讓使用者以 PATCH /versions/:id 選擇。
 */
export function detectEntry(pages: readonly PageInfo[], requested?: string): EntryDecision {
  const paths = pages.map((p) => p.path);
  if (paths.length === 0) throw new AppError('IMPORT_NO_HTML', '沒有任何 HTML 頁面');
  if (requested !== undefined && requested !== '') {
    if (!paths.includes(requested)) {
      throw new AppError('BAD_REQUEST', `entryPage 不是 bundle 內的 HTML 頁面：${requested}`);
    }
    return { status: 'ready', entryPage: requested, candidates: null };
  }
  for (const name of ['index.html', 'index.htm']) {
    if (paths.includes(name)) return { status: 'ready', entryPage: name, candidates: null };
  }
  if (paths.length === 1) return { status: 'ready', entryPage: paths[0]!, candidates: null };
  return { status: 'processing', entryPage: '', candidates: paths };
}
