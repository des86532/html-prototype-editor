import { PAYLOAD_PLACEHOLDER, PAYLOAD_SCRIPT_ID, parsePayload } from '@hpe/exporter/browser';
import type { SingleFilePayload } from '@hpe/exporter/browser';

/** 從 `<script type="application/json" id="hpe-data">` 讀出並驗證 payload（只用 textContent + JSON.parse）。 */
export function readPayload(doc: Document): SingleFilePayload {
  const el = doc.getElementById(PAYLOAD_SCRIPT_ID);
  if (!el) throw new Error('找不到匯出資料（#hpe-data）。');
  const text = (el.textContent ?? '').trim();
  if (text === '' || text === PAYLOAD_PLACEHOLDER) {
    throw new Error('這是尚未填入資料的 shell 範本，請從 HTML Prototype Editor 匯出。');
  }
  return parsePayload(text);
}

/** 啟動失敗時顯示錯誤；一律用 textContent。 */
export function showFatal(root: HTMLElement, error: unknown): void {
  const box = root.ownerDocument.createElement('div');
  box.setAttribute('role', 'alert');
  box.className = 'm-8 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900';
  box.textContent = `無法開啟匯出檔：${error instanceof Error ? error.message : String(error)}`;
  root.replaceChildren(box);
}
