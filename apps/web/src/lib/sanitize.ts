import DOMPurify from 'dompurify';
import { isSafeHref, renderMarkdownUnsafe } from './markdown';

/**
 * Trusted Types：CSP `require-trusted-types-for 'script'; trusted-types default dompurify`。
 *  - `dompurify`：DOMPurify 自己建立的 policy（它內部以這個名稱註冊）。
 *  - `default`：任何把字串送進 sink 的漏網之魚都會經過這裡：HTML 一律 sanitize，script／scriptURL 一律拒絕。
 * 本專案的程式碼不使用任何字串 HTML sink（ESLint 禁止 innerHTML 等），default policy 只是最後防線。
 */
export const TRUSTED_TYPES_POLICY_NAMES = ['default', 'dompurify'] as const;

export const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'em',
  'del',
  's',
  'code',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'li',
  'a',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
] as const;
export const ALLOWED_ATTR = ['href', 'target', 'rel'] as const;

const CONFIG = {
  ALLOWED_TAGS: [...ALLOWED_TAGS],
  ALLOWED_ATTR: [...ALLOWED_ATTR],
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i,
  FORBID_TAGS: ['style', 'script', 'img', 'svg', 'math', 'form', 'input', 'iframe', 'object'],
  KEEP_CONTENT: true,
};

let hooked = false;
function ensureHooks(): void {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName !== 'A') return;
    const href = node.getAttribute('href');
    if (href === null || !isSafeHref(href)) {
      node.removeAttribute('href');
      node.removeAttribute('target');
      node.removeAttribute('rel');
      return;
    }
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer nofollow');
  });
}

/** HTML 字串 → 已淨化的 DocumentFragment（不經 innerHTML）。 */
export function sanitizeToFragment(html: string): DocumentFragment {
  ensureHooks();
  return DOMPurify.sanitize(html, { ...CONFIG, RETURN_DOM_FRAGMENT: true });
}

/** HTML 字串 → 已淨化的 HTML 字串（只給 Trusted Types default policy 與測試使用）。 */
export function sanitizeToString(html: string): string {
  ensureHooks();
  return String(DOMPurify.sanitize(html, { ...CONFIG, RETURN_TRUSTED_TYPE: false }));
}

export function markdownToFragment(source: string): DocumentFragment {
  return sanitizeToFragment(renderMarkdownUnsafe(source));
}

interface TrustedTypesFactory {
  createPolicy(
    name: string,
    rules: {
      createHTML?: (s: string) => string;
      createScript?: (s: string) => string;
      createScriptURL?: (s: string) => string;
    },
  ): unknown;
}

/**
 * 在 React render 之前呼叫。沒有 Trusted Types 的環境（jsdom、Firefox 舊版）直接略過。
 * 回傳是否真的安裝了 policy。
 */
export function installTrustedTypesPolicy(
  tt: TrustedTypesFactory | undefined = (globalThis as { trustedTypes?: TrustedTypesFactory })
    .trustedTypes,
): boolean {
  if (!tt) return false;
  ensureHooks();
  // 先讓 DOMPurify 註冊它的 `dompurify` policy，之後才安裝 default，避免遞迴。
  sanitizeToString('');
  try {
    tt.createPolicy('default', {
      createHTML: (s) => sanitizeToString(s),
      createScript: () => {
        throw new TypeError('Trusted Types: script sinks are not allowed');
      },
      createScriptURL: () => {
        throw new TypeError('Trusted Types: script URL sinks are not allowed');
      },
    });
    return true;
  } catch {
    return false;
  }
}
