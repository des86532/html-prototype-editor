import type { Thread } from '@hpe/shared';
import { bestSelector, elementLabel, sortThreads } from './common.js';
import type { ExportInput } from './types.js';

export const CSV_COLUMNS = [
  'number',
  'page',
  'status',
  'tags',
  'author',
  'createdAt',
  'breakpointWidth',
  'element',
  'selector',
  'firstComment',
  'replyCount',
  'allComments',
  'resolvedAt',
] as const;

const FORMULA_START = /^[ \u00a0]*[=+\-@]|^[\t\r]/;

/** 防公式注入（V20）：以 `=`、`+`、`-`、`@`、Tab、CR 開頭（含前置空白）的儲存格前面加 `'`。 */
export function neutralizeFormula(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

/** RFC 4180：含 `,` `"` CR LF 的欄位加引號，內部 `"` 變 `""`。 */
export function quoteCsvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function csvCell(value: string | number): string {
  return quoteCsvField(neutralizeFormula(String(value)));
}

export function toCsv(
  rows: readonly (readonly (string | number)[])[],
  opts?: { bom?: boolean },
): string {
  const body = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  return `${opts?.bom ? '\uFEFF' : ''}${body}\r\n`;
}

function row(t: Thread): (string | number)[] {
  const [first, ...replies] = t.comments;
  return [
    t.number,
    t.anchor.pageId,
    t.status,
    t.tags.join(';'),
    t.createdBy.name,
    t.createdAt,
    Math.round(t.anchor.viewport.width),
    elementLabel(t),
    bestSelector(t),
    first?.body ?? '',
    replies.length,
    t.comments.map((c) => `${c.author.name}: ${c.body}`).join('\n'),
    t.resolvedAt ?? '',
  ];
}

/** 一列一則討論串。`bom: true` 時加 UTF-8 BOM 讓 Excel 正確辨識。 */
export function buildCsv(input: ExportInput, opts?: { bom?: boolean }): string {
  return toCsv([[...CSV_COLUMNS], ...sortThreads(input.threads).map(row)], opts);
}
