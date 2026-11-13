import type { AnnotationsDocument, Thread } from '@hpe/shared';
import { AnnotationsDocumentSchema } from '@hpe/shared';

/* 本檔只依賴 @hpe/shared（無 parse5／fflate／Node API），export-viewer shell 直接打包它。 */

/** 內嵌到 `<script>` 時避免提前結束或進入 script-data 的註解狀態。 */
export function escapeForScript(js: string): string {
  return js.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
}

/**
 * 單檔匯出 shell 的 CSP（規格第 5 節，逐字）。srcdoc iframe 會繼承它，
 * 所以匯出檔完全無法連網（V22：`connect-src 'none'`）。
 */
export const EXPORT_SHELL_CSP =
  "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'";

/** shell HTML 內的資料標籤 id。 */
export const PAYLOAD_SCRIPT_ID = 'hpe-data';
/** shell 在 `<script type="application/json" id="hpe-data">` 內放的佔位符，必須出現恰好一次。 */
export const PAYLOAD_PLACEHOLDER = '<!--HPE_PAYLOAD-->';

/**
 * 嵌入 shell 的 JSON payload。Shell 契約：
 * 1. `JSON.parse(document.getElementById('hpe-data').textContent)`；
 * 2. 載入頁面 P 時，以 `injectAgent(pages[P], agentSource, P)`（或等價邏輯）產生 srcdoc：
 *    agent 必須是 `<head>` 第一個子節點的 inline `<script data-hpe-page="P">`，且 `</script`、`<!--` 要跳脫；
 * 3. 所有使用者文字（留言、作者、selector）一律用 `textContent` 渲染。
 */
export interface SingleFilePayload {
  format: 'hpe-single-file';
  formatVersion: 1;
  meta: SingleFileMeta;
  annotations: AnnotationsDocument;
  /** 頁面路徑 → inline 化之後的 HTML（來自 `inlineAssets`），不含 agent。 */
  pages: Record<string, string>;
  /** `dist/agent.v1.js` 的原始碼；shell 在每個 srcdoc 內以 inline script 注入。 */
  agentSource: string;
}

export interface SingleFileMeta {
  projectName: string;
  versionNumber: number;
  entryPage: string;
  exportedAt: string;
}

/**
 * `JSON.stringify` 後把 `<`、`>`、`&`、U+2028、U+2029 跳脫成 `\uXXXX`（V21）。
 * 這些字元只會出現在 JSON 字串內，所以結果仍是等價的合法 JSON。
 */
export function escapeJsonForScript(json: string): string {
  return json.replace(
    /[<>&\u2028\u2029]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

export function serializePayload(payload: SingleFilePayload): string {
  return escapeJsonForScript(JSON.stringify(payload));
}

/** shell 啟動時用：JSON.parse 並驗證 payload 結構（annotations 走 shared 的 zod schema）。 */
export function parsePayload(text: string): SingleFilePayload {
  const raw: unknown = JSON.parse(text);
  if (typeof raw !== 'object' || raw === null) throw new Error('payload must be an object');
  const r = raw as Record<string, unknown>;
  if (r.format !== 'hpe-single-file' || r.formatVersion !== 1)
    throw new Error('unsupported payload');
  const annotations = AnnotationsDocumentSchema.parse(r.annotations);
  const pages = r.pages;
  if (typeof pages !== 'object' || pages === null) throw new Error('payload.pages missing');
  for (const v of Object.values(pages)) {
    if (typeof v !== 'string') throw new Error('payload.pages must map to strings');
  }
  if (typeof r.agentSource !== 'string') throw new Error('payload.agentSource missing');
  const meta = r.meta as SingleFileMeta | undefined;
  if (!meta || typeof meta.projectName !== 'string' || typeof meta.entryPage !== 'string') {
    throw new Error('payload.meta invalid');
  }
  return {
    format: 'hpe-single-file',
    formatVersion: 1,
    meta,
    annotations,
    pages: pages as Record<string, string>,
    agentSource: r.agentSource,
  };
}

/** annotations.json（`x-hpe:` 欄位）→ Thread[]（依編號排序）。shell 與再匯入共用。 */
export function annotationsToThreads(doc: AnnotationsDocument): Thread[] {
  return [...doc.items]
    .sort((a, b) => a['x-hpe:number'] - b['x-hpe:number'])
    .map((it) => ({
      id: it['x-hpe:threadId'],
      versionId: doc.version.id,
      number: it['x-hpe:number'],
      anchor: it['x-hpe:anchor'],
      status: it['x-hpe:status'],
      tags: [...it['x-hpe:tags']],
      createdBy: it['x-hpe:createdBy'],
      createdAt: it.created,
      ...(it['x-hpe:resolvedAt'] === undefined ? {} : { resolvedAt: it['x-hpe:resolvedAt'] }),
      comments: it['x-hpe:comments'],
    }));
}

function escapeAttr(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** 在 agent 之前執行，讓 agent 進入匯出模式（bundle 內連結改送 `navigateRequest`）。 */
export const EXPORT_MODE_SCRIPT = '<script>window.__HPE_EXPORT__=true</script>';

/**
 * 產生 srcdoc：先放匯出旗標，再把 agent 當成 inline script，一起放在 `<head>` 最前面
 * （與內容伺服器的注入規則一致，只是 src 換成 inline）。純字串運算，瀏覽器與 Node 共用。
 */
export function injectAgent(pageHtml: string, agentSource: string, pagePath: string): string {
  const script = `${EXPORT_MODE_SCRIPT}<script data-hpe-page="${escapeAttr(pagePath)}">${escapeForScript(agentSource)}</script>`;
  const head = /<head(?=[\s>/])[^>]*>/i.exec(pageHtml);
  if (head) {
    const at = head.index + head[0].length;
    return `${pageHtml.slice(0, at)}${script}${pageHtml.slice(at)}`;
  }
  const htmlTag = /<html(?=[\s>/])[^>]*>/i.exec(pageHtml);
  if (htmlTag) {
    const at = htmlTag.index + htmlTag[0].length;
    return `${pageHtml.slice(0, at)}<head>${script}</head>${pageHtml.slice(at)}`;
  }
  const doctype = /^\s*<!doctype[^>]*>/i.exec(pageHtml);
  const at = doctype ? doctype[0].length : 0;
  return `${pageHtml.slice(0, at)}<head>${script}</head>${pageHtml.slice(at)}`;
}
