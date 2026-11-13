import type { AnnotationsDocument } from '@hpe/shared';
import {
  EXPORT_SHELL_CSP,
  PAYLOAD_PLACEHOLDER,
  PAYLOAD_SCRIPT_ID,
  serializePayload,
  type SingleFileMeta,
  type SingleFilePayload,
} from './browser.js';
import { EXPORT_WARN_BYTES } from './types.js';

const PLACEHOLDER_RE = new RegExp(
  `(<script\\b(?=[^>]*\\btype=["']application/json["'])(?=[^>]*\\bid=["']${PAYLOAD_SCRIPT_ID}["'])[^>]*>)\\s*${PAYLOAD_PLACEHOLDER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(</script>)`,
  'gi',
);
const CSP_META_RE = /<meta\b[^>]*http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi;

export interface BuildSingleFileOptions {
  /** `packages/export-viewer` 建出的單檔 shell，包含 `<script type="application/json" id="hpe-data"><!--HPE_PAYLOAD--></script>`。 */
  shellHtml: string;
  annotations: AnnotationsDocument;
  pages: Record<string, string>;
  agentSource: string;
  meta: SingleFileMeta;
}

export interface SingleFileResult {
  html: string;
  bytes: number;
  /** 超過 20 MB，UI 應提醒。 */
  warnLarge: boolean;
}

export function buildSingleFileHtml(opts: BuildSingleFileOptions): SingleFileResult {
  const { shellHtml } = opts;
  const matches = shellHtml.match(PLACEHOLDER_RE);
  if (!matches || matches.length !== 1 || shellHtml.split(PAYLOAD_PLACEHOLDER).length !== 2) {
    throw new Error(
      `shell must contain exactly one ${PAYLOAD_PLACEHOLDER} inside script#${PAYLOAD_SCRIPT_ID}`,
    );
  }
  const payload = serializePayload({
    format: 'hpe-single-file',
    formatVersion: 1,
    meta: opts.meta,
    annotations: opts.annotations,
    pages: opts.pages,
    agentSource: opts.agentSource,
  });
  // 用函式替換，避免 payload 內的 `$&`、`$1` 被當成替換樣式。
  let html = shellHtml.replace(
    PLACEHOLDER_RE,
    (_m, open: string, close: string) => `${open}${payload}${close}`,
  );

  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${EXPORT_SHELL_CSP}">`;
  if (CSP_META_RE.test(html)) {
    CSP_META_RE.lastIndex = 0;
    html = html.replace(CSP_META_RE, () => cspMeta);
  } else {
    const head = /<head(?=[\s>/])[^>]*>/i.exec(html);
    if (!head) throw new Error('shell must contain a <head> element');
    const at = head.index + head[0].length;
    html = `${html.slice(0, at)}${cspMeta}${html.slice(at)}`;
  }
  CSP_META_RE.lastIndex = 0;

  const bytes = new TextEncoder().encode(html).length;
  return { html, bytes, warnLarge: bytes > EXPORT_WARN_BYTES };
}

/** 讀回嵌入的 payload（測試與 shell 以外的工具用；shell 本身用 DOM `textContent`）。 */
export function extractPayload(html: string): SingleFilePayload {
  const m = new RegExp(
    `<script\\b(?=[^>]*\\bid=["']${PAYLOAD_SCRIPT_ID}["'])[^>]*>([\\s\\S]*?)</script>`,
    'i',
  ).exec(html);
  if (!m) throw new Error('payload script not found');
  return JSON.parse(m[1]!) as SingleFilePayload;
}
