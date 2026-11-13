/// <reference lib="dom" />
import { MESSAGE_LIMITS } from '@hpe/shared';

const HTML_NS = 'http://www.w3.org/1999/xhtml';

function step(el: Element): string {
  let index = 1;
  for (let s = el.previousElementSibling; s; s = s.previousElementSibling) {
    if (s.localName === el.localName && s.namespaceURI === el.namespaceURI) index++;
  }
  return el.namespaceURI === HTML_NS
    ? `${el.localName}[${index}]`
    : `*[local-name()='${el.localName}'][${index}]`;
}

/** 完整位置路徑，例如 `/html[1]/body[1]/div[2]/ul[1]/li[3]`；超過長度上限時回傳 undefined。 */
export function xpathOf(el: Element): string | undefined {
  const steps: string[] = [];
  for (let n: Element | null = el; n; n = n.parentElement) steps.unshift(step(n));
  const xp = '/' + steps.join('/');
  return xp.length <= MESSAGE_LIMITS.maxSelectorLength ? xp : undefined;
}

const STEP_RE = /^(?:([A-Za-z][\w.-]*)|\*\[local-name\(\)='([^'\]]+)'\])\[(\d{1,5})\]$/;

/**
 * 只解析 `xpathOf` 產生的子集（逐層 name[n]），不使用 document.evaluate：
 * 不受 XPath 引擎差異影響，也不會被惡意 xpath 字串拖慢。其他格式一律回傳 null。
 */
export function evalXPath(doc: Document, xpath: string): Element | null {
  if (xpath.length > MESSAGE_LIMITS.maxSelectorLength || xpath[0] !== '/') return null;
  const steps = xpath.slice(1).split('/');
  let cur: Element | null = null as Element | null;
  for (let i = 0; i < steps.length; i++) {
    const m = STEP_RE.exec(steps[i] ?? '');
    if (!m) return null;
    const name = m[1] ?? m[2] ?? '';
    const want = Number(m[3]);
    const html = m[1] !== undefined;
    const pool: ArrayLike<Element> | null =
      i === 0 ? (doc.documentElement ? [doc.documentElement] : []) : cur ? cur.children : null;
    if (!pool) return null;
    let seen = 0;
    let found: Element | null = null;
    for (let j = 0; j < pool.length; j++) {
      const c: Element | undefined = pool[j];
      if (!c || c.localName !== name || (c.namespaceURI === HTML_NS) !== html) continue;
      if (++seen === want) {
        found = c;
        break;
      }
    }
    if (!found) return null;
    cur = found;
  }
  return cur;
}
