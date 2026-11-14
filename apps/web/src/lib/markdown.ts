import MarkdownIt from 'markdown-it';

/** 只允許這些 scheme 出現在連結（規格 Impact：markdown 連結白名單）。 */
const SAFE_LINK = /^(https?:|mailto:)/i;

export function isSafeHref(href: string): boolean {
  // 去掉控制字元與空白，避免 `java\tscript:` 之類的繞過。
  // eslint-disable-next-line no-control-regex
  const cleaned = href.replace(/[\u0000-\u0020\u007f-\u009f]/g, '');
  return SAFE_LINK.test(cleaned);
}

function createMarkdown() {
  const md = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: false });
  // 圖片會對外發請求（資料外送），評論內不支援：關閉規則，語法會原樣顯示為文字。
  md.disable(['image', 'html_block', 'html_inline']);
  md.validateLink = isSafeHref;
  md.linkify.set({ fuzzyLink: false, fuzzyEmail: false, fuzzyIP: false });

  const defaultOpen =
    md.renderer.rules.link_open ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx]!;
    token.attrSet('target', '_blank');
    token.attrSet('rel', 'noopener noreferrer nofollow');
    return defaultOpen(tokens, idx, options, env, self);
  };
  return md;
}

const md = createMarkdown();

/** markdown → HTML 字串（不可信！必須再經 `lib/sanitize` 的 DOMPurify 才能使用）。 */
export function renderMarkdownUnsafe(source: string): string {
  return md.render(source);
}
