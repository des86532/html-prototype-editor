import { FrameToParentSchema, type FrameToParent, type ParentToFrame } from '@hpe/shared';
import type { AgentBridge } from './bridge-types.js';

/** picker／geometry 測試用的假 bridge：記錄送出的訊息（並用共用 zod schema 驗證），可手動投遞 parent 訊息。 */
export function fakeBridge(pageId = 'index.html') {
  const sent: FrameToParent[] = [];
  const subs = new Set<(m: ParentToFrame) => void>();
  const bridge: AgentBridge = {
    send: (m) => {
      sent.push(FrameToParentSchema.parse(m));
    },
    subscribe: (h) => {
      subs.add(h);
      return () => subs.delete(h);
    },
    pageId: () => pageId,
  };
  return { bridge, sent, deliver: (m: ParentToFrame) => subs.forEach((h) => h(m)), subs };
}

/** 可手動推進的 requestAnimationFrame。 */
export function fakeRaf() {
  let queue: (() => void)[] = [];
  return {
    raf: (cb: () => void) => queue.push(cb),
    cancelRaf: () => {
      queue = [];
    },
    flush: () => {
      const q = queue;
      queue = [];
      q.forEach((cb) => cb());
    },
    pending: () => queue.length,
  };
}

/** 用 DOMParser 替換 document.body 的內容（lint 禁止直接指派 innerHTML）。 */
export function setBody(html: string): void {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  document.body.replaceChildren(...Array.from(parsed.body.childNodes));
}
