import type { ReactNode } from 'react';

/** `#rgb`／`#rrggbb`：前面不能是文字、`&`、`#`（排除 `&#123;`、`a#fff`、`##fff`），後面不能接文字字元。 */
export const HEX_COLOR_RE = /(?<![\w&#])#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_])/g;

const MENTION_END = '(?=$|[\\s.,!?;:，。！？、)\\]])';

function linear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** 依亮度回傳可讀的文字色：相對亮度 > 0.55 用 '#24211c'，否則 '#ffffff'。3 碼先展開成 6 碼。 */
export function readableTextColor(hex: string): string {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const n = parseInt(h, 16);
  const lum =
    0.2126 * linear((n >> 16) & 255) + 0.7152 * linear((n >> 8) & 255) + 0.0722 * linear(n & 255);
  return lum > 0.55 ? '#24211c' : '#ffffff';
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function colorNodes(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(HEX_COLOR_RE)) {
    const hex = m[0];
    const at = m.index;
    if (at > last) out.push(text.slice(last, at));
    out.push(
      <span
        key={`${keyPrefix}:c${at}`}
        data-color={hex.toLowerCase()}
        className="inline-flex items-center rounded px-1 font-mono text-[0.85em] ring-1 ring-line"
        style={{ backgroundColor: hex, color: readableTextColor(hex) }}
      >
        {hex}
      </span>,
    );
    last = at + hex.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * 把一段純文字切成文字＋色碼標籤＋提及標籤（全是 React 節點，不經 innerHTML）。
 * mentionNames 依長度由長到短比對（「Guest Gina」優先於「Guest」）；為空時跳過提及比對。
 */
export function decorateText(
  text: string,
  mentionNames: readonly string[],
  keyPrefix: string,
): ReactNode[] {
  const names = [...new Set(mentionNames.filter((n) => n.length > 0))].sort(
    (a, b) => b.length - a.length,
  );
  if (names.length === 0) return colorNodes(text, keyPrefix);

  const re = new RegExp(
    `(?<![A-Za-z0-9_])@(?:${names.map(escapeRe).join('|')})${MENTION_END}`,
    'g',
  );
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index;
    if (at > last) out.push(...colorNodes(text.slice(last, at), `${keyPrefix}:t${last}`));
    out.push(
      <span
        key={`${keyPrefix}:m${at}`}
        data-mention=""
        className="rounded bg-accent-soft px-0.5 font-medium text-accent"
      >
        {m[0]}
      </span>,
    );
    last = at + m[0].length;
  }
  if (last < text.length) out.push(...colorNodes(text.slice(last), `${keyPrefix}:t${last}`));
  return out;
}
