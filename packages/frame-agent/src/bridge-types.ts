import type { FrameToParent, ParentToFrame } from '@hpe/shared';

/**
 * frame-agent 內部模組之間的契約（bridge.ts 實作；picker.ts、geometry.ts 等只依賴這個介面）。
 * agent 與 prototype 的 script 在同一個 JS realm，這個介面「不是」安全邊界。
 */
export interface AgentBridge {
  /** 送訊息給 parent（postMessage，targetOrigin '*'）。 */
  send(msg: FrameToParent): void;
  /** 訂閱 parent 傳來的（已驗證）訊息；回傳取消訂閱函式。 */
  subscribe(handler: (msg: ParentToFrame) => void): () => void;
  /** 目前頁面在 bundle 內的路徑（來自注入 script 的 data-hpe-page 屬性），例如 "pricing.html"。 */
  pageId(): string;
}

/** 每個功能模組（picker、geometry、navGuard…）都是 `install(bridge)`，回傳 dispose。 */
export type AgentModule = (bridge: AgentBridge) => () => void;
