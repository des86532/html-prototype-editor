import type { MarkupShape, Thread, ThreadStatus } from '@hpe/shared';

/**
 * 卡片與標記面板共用的動作。所有方法在失敗時應 reject 一個 `Error`，其 message 是可直接顯示給使用者的文字
 * （由 container 把 ApiError 轉成繁體中文）。元件本身不知道 API 或 store。
 */
export interface ThreadActions {
  onReply(thread: Thread, body: string): Promise<void> | void;
  onSetStatus(thread: Thread, status: ThreadStatus): Promise<void> | void;
  onEditComment(thread: Thread, commentId: string, body: string): Promise<void> | void;
  onDeleteComment(thread: Thread, commentId: string): Promise<void> | void;
  onCopyLink(thread: Thread): Promise<void> | void;
  onMoveMarkup(thread: Thread, shape: MarkupShape): Promise<void> | void;
  onDeleteThread(thread: Thread): Promise<void> | void;
}
