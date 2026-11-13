import { createElement, useMemo, type ReactNode } from 'react';
import { isSafeHref } from './markdown';
import { ALLOWED_TAGS, markdownToFragment } from './sanitize';

const TAGS: ReadonlySet<string> = new Set(ALLOWED_TAGS);

function convert(node: Node, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  const children = Array.from(el.childNodes).map((c, i) => convert(c, `${key}.${i}`));
  if (!TAGS.has(tag)) return children; // 不在白名單：只留文字內容
  if (tag === 'br' || tag === 'hr') return createElement(tag, { key });
  const props: Record<string, unknown> = { key };
  if (tag === 'a') {
    const href = el.getAttribute('href');
    if (href !== null && isSafeHref(href)) {
      props.href = href;
      props.target = '_blank';
      props.rel = 'noopener noreferrer nofollow';
      props.className = 'text-blue-600 underline';
    }
  }
  return createElement(tag, props, ...children);
}

export interface SafeMarkdownProps {
  source: string;
  className?: string;
}

/**
 * 所有使用者內容的唯一渲染入口：markdown-it（html:false）→ DOMPurify（嚴格白名單）→ 白名單 DOM→React walker。
 * 不使用 dangerouslySetInnerHTML／innerHTML。
 */
export function SafeMarkdown({ source, className }: SafeMarkdownProps) {
  const tree = useMemo(() => {
    const frag = markdownToFragment(source);
    return Array.from(frag.childNodes).map((n, i) => convert(n, String(i)));
  }, [source]);
  return (
    <div
      className={`hpe-md break-words text-sm [&_blockquote]:border-l-2 [&_blockquote]:pl-2 [&_code]:rounded [&_code]:bg-neutral-100 [&_code]:px-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_pre]:overflow-x-auto [&_ul]:list-disc [&_ul]:pl-5 ${className ?? ''}`}
    >
      {tree}
    </div>
  );
}
