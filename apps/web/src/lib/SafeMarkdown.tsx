import { createElement, useMemo, type ReactNode } from 'react';
import { decorateText } from './decorateText';
import { isSafeHref } from './markdown';
import { ALLOWED_TAGS, markdownToFragment } from './sanitize';

const TAGS: ReadonlySet<string> = new Set(ALLOWED_TAGS);

/** 這些元素內的文字保持原樣：程式碼與連結裡的 `#fff`、`@名字` 不是色碼或提及。 */
const PLAIN_TAGS: ReadonlySet<string> = new Set(['code', 'pre', 'a']);

function convert(
  node: Node,
  key: string,
  mentionNames: readonly string[],
  plain: boolean,
): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? '';
    return plain ? text : decorateText(text, mentionNames, key);
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  const childPlain = plain || PLAIN_TAGS.has(tag);
  const children = Array.from(el.childNodes).map((c, i) =>
    convert(c, `${key}.${i}`, mentionNames, childPlain),
  );
  if (!TAGS.has(tag)) return children; // 不在白名單：只留文字內容
  if (tag === 'br' || tag === 'hr') return createElement(tag, { key });
  const props: Record<string, unknown> = { key };
  if (tag === 'a') {
    const href = el.getAttribute('href');
    if (href !== null && isSafeHref(href)) {
      props.href = href;
      props.target = '_blank';
      props.rel = 'noopener noreferrer nofollow';
      props.className = 'text-accent underline';
    }
  }
  return createElement(tag, props, ...children);
}

const NO_NAMES: readonly string[] = [];

export interface SafeMarkdownProps {
  source: string;
  className?: string;
  /** 以醒目樣式顯示的 `@名字` */
  mentionNames?: readonly string[];
}

/**
 * 所有使用者內容的唯一渲染入口：markdown-it（html:false）→ DOMPurify（嚴格白名單）→ 白名單 DOM→React walker。
 * 不使用 dangerouslySetInnerHTML／innerHTML。
 */
export function SafeMarkdown({ source, className, mentionNames = NO_NAMES }: SafeMarkdownProps) {
  const tree = useMemo(() => {
    const frag = markdownToFragment(source);
    return Array.from(frag.childNodes).map((n, i) => convert(n, String(i), mentionNames, false));
  }, [source, mentionNames]);
  return (
    <div
      className={`hpe-md break-words text-sm [&_blockquote]:border-l-2 [&_blockquote]:pl-2 [&_code]:rounded [&_code]:bg-paper [&_code]:px-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_pre]:overflow-x-auto [&_ul]:list-disc [&_ul]:pl-5 ${className ?? ''}`}
    >
      {tree}
    </div>
  );
}
