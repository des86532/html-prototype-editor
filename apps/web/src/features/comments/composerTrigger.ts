import { MARKUP_COLORS } from '@hpe/shared';

export type Trigger = { kind: 'color' | 'mention'; start: number; query: string } | null;

/** 常用色：標記色盤加三個（白、紫、粉）。 */
export const COLOR_PRESETS = [...MARKUP_COLORS, '#ffffff', '#5b5bd6', '#d6409f'] as const;

const MENTION_QUERY_MAX = 40;
const COLOR_QUERY_RE = /^[0-9a-fA-F]{0,6}$/;
const OPENERS = new Set(['(', '[', '（', '「']);

function startsToken(value: string, i: number): boolean {
  if (i === 0) return true;
  const prev = value[i - 1]!;
  return /\s/.test(prev) || OPENERS.has(prev);
}

/**
 * 依游標位置找觸發字元：start 是 `#` 或 `@` 的位置；前一字元必須是行首、空白或 ([（「。
 * 往回找到的第一個 `#`／`@` 決定結果（不跨換行）。
 */
export function findTrigger(value: string, caret: number): Trigger {
  const stop = Math.max(0, caret - MENTION_QUERY_MAX - 1);
  for (let i = caret - 1; i >= stop; i--) {
    const ch = value[i]!;
    if (ch === '\n') return null;
    if (ch !== '#' && ch !== '@') continue;
    if (!startsToken(value, i)) return null;
    const query = value.slice(i + 1, caret);
    if (ch === '#') return COLOR_QUERY_RE.test(query) ? { kind: 'color', start: i, query } : null;
    return query.length <= MENTION_QUERY_MAX ? { kind: 'mention', start: i, query } : null;
  }
  return null;
}

/** 把 `value[start, caret)`（觸發字元加 query）換成 text。caret 以觸發位置加 query 長度推算。 */
export function applyInsert(
  value: string,
  t: NonNullable<Trigger>,
  text: string,
): { value: string; caret: number } {
  const end = t.start + 1 + t.query.length;
  return { value: value.slice(0, t.start) + text + value.slice(end), caret: t.start + text.length };
}
