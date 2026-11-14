/** 相對時間（繁體中文）。 */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const sec = Math.round((now - t) / 1000);
  if (sec < 45) return '剛剛';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} 分鐘前`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} 小時前`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(t).toLocaleDateString('zh-TW');
}

/** 取純文字前 n 行（預覽用）。 */
export function firstLines(text: string, n: number): string {
  return text.split(/\r?\n/).slice(0, n).join('\n');
}

/** 截斷到指定長度（以 code point 計）。 */
export function truncate(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max).join('')}…`;
}

export const TAG_LABELS = {
  bug: 'Bug',
  copy: '文案',
  design: '設計',
  question: '問題',
  suggestion: '建議',
} as const;
