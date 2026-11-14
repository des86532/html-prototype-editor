import type { Comment, Thread } from '@hpe/shared';
import { bestSelector, breakpointLabel, elementLabel, exportedAt, groupByPage } from './common.js';
import type { ExportInput } from './types.js';

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000e-\u001f\u007f]/g;
// eslint-disable-next-line no-control-regex
const LINE_BREAKS = /\r\n|[\r\n\u000b\u000c\u0085\u2028\u2029]/;
const MD_SPECIAL = /[\\`*_{}[\]()#+\-.!|<>~&=]/g;
const DANGEROUS_SCHEME = /\b(javascript|vbscript|data)(\s*):/gi;

/**
 * 跳脫單行文字中的 Markdown 控制字元（`\ ` * _ { } [ ] ( ) # + - . ! | < > ~` 以及 `& =`），
 * 並把換行折成空白。`javascript:` 等 scheme 的冒號也被跳脫，不會成為可點擊連結。
 */
export function escapeMarkdown(text: string): string {
  return text
    .replace(CONTROL, '')
    .split(LINE_BREAKS)
    .join(' ')
    .replace(MD_SPECIAL, '\\$&')
    .replace(DANGEROUS_SCHEME, '$1$2\\:');
}

/** 內文轉成引用區塊：每一行（含注入的換行）都以 `> ` 開頭，各行獨立跳脫。 */
export function toBlockquote(text: string): string {
  return text
    .replace(CONTROL, '')
    .split(LINE_BREAKS)
    .map((line) => {
      const esc = escapeMarkdown(line);
      return esc.trim() === '' ? '>' : `> ${esc}`;
    })
    .join('\n');
}

function formatTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return escapeMarkdown(iso);
  return `${new Date(t).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function renderComment(c: Comment, index: number): string[] {
  const label = index === 0 ? '留言' : `回覆 ${index}`;
  return [
    `> **${escapeMarkdown(c.author.name)}** · ${label} · ${formatTime(c.createdAt)}`,
    '>',
    toBlockquote(c.body),
  ];
}

function renderThread(t: Thread): string[] {
  const lines: string[] = [`### #${t.number}`, ''];
  lines.push(`- 作者：${escapeMarkdown(t.createdBy.name)}`);
  lines.push(`- 時間：${formatTime(t.createdAt)}`);
  lines.push(`- 狀態：${t.status === 'resolved' ? '已解決' : '未解決'}`);
  if (t.resolvedAt) lines.push(`- 解決時間：${formatTime(t.resolvedAt)}`);
  if (t.tags.length > 0) lines.push(`- 標籤：${t.tags.map(escapeMarkdown).join(', ')}`);
  lines.push(`- 元素：${escapeMarkdown(elementLabel(t))}`);
  const sel = bestSelector(t);
  if (sel) lines.push(`- Selector：${escapeMarkdown(sel)}`);
  lines.push(`- Breakpoint：${escapeMarkdown(breakpointLabel(t))}`);
  lines.push('');
  t.comments.forEach((c, i) => {
    lines.push(...renderComment(c, i), '');
  });
  return lines;
}

/** 依頁面分組的 Markdown；編號與 pin 一致。不輸出任何原始 HTML。 */
export function buildMarkdown(input: ExportInput): string {
  const { project, version, threads } = input;
  const out: string[] = [
    `# ${escapeMarkdown(project.name)} v${version.number} 評論匯出`,
    '',
    `匯出時間：${formatTime(exportedAt(input))} · 討論串：${threads.length}`,
    '',
  ];
  for (const group of groupByPage(
    threads,
    version.pages.map((p) => p.path),
  )) {
    out.push(`## 頁面：${escapeMarkdown(group.page)}`, '');
    for (const t of group.threads) out.push(...renderThread(t));
  }
  return `${out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`;
}
