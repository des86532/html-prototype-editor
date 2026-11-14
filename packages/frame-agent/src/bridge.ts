import { PROTOCOL_VERSION, type FrameToParent, type ParentToFrame } from '@hpe/shared';
import type { AgentBridge } from './bridge-types.js';
import { parseParentMessageLite } from './validate.js';

/** 從注入的 `<script data-hpe-page>` 取得目前頁面在 bundle 內的路徑。 */
function readPageId(doc: Document, win: Window): string {
  const current = doc.currentScript;
  const el = current?.hasAttribute('data-hpe-page')
    ? current
    : doc.querySelector('script[data-hpe-page]');
  const attr = el?.getAttribute('data-hpe-page');
  if (attr) return attr;
  try {
    return decodeURIComponent(win.location.pathname).replace(/^\/+/, '') || 'index.html';
  } catch {
    return 'index.html';
  }
}

/**
 * agent 與 parent 之間的橋。agent 與 prototype 在同一個 JS realm，這裡不是安全邊界（D5）：
 * 只接受 `event.source === window.parent` 且通過 `parseParentMessageLite`（見 validate.ts：zod 版本太大） 的訊息，
 * 送出一律用 targetOrigin '*'（frame 是 opaque origin，沒有可指定的 origin）。
 */
export function createBridge(win: Window = window): AgentBridge {
  const handlers = new Set<(msg: ParentToFrame) => void>();
  const pageId = readPageId(win.document, win);

  win.addEventListener('message', (event: MessageEvent) => {
    // 直接開啟 content URL（沒有 parent）時，window.parent === window：不處理任何訊息。
    if (win.parent === win || event.source !== win.parent) return;
    const parsed = parseParentMessageLite(event.data);
    if (!parsed.ok) return;
    for (const h of [...handlers]) {
      try {
        h(parsed.value);
      } catch {
        /* 單一模組的錯誤不能影響其他模組 */
      }
    }
  });

  return {
    send(msg: FrameToParent) {
      if (win.parent === win) return;
      try {
        win.parent.postMessage({ ...msg, v: PROTOCOL_VERSION }, '*');
      } catch {
        /* parent 不可用 */
      }
    },
    subscribe(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    pageId: () => pageId,
  };
}
