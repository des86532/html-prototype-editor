import { useEffect, useRef, useState } from 'react';
import {
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
} from '@floating-ui/react';
import { POPOVER_WIDTH_PX, type Thread } from '@hpe/shared';
import { useLatest } from '@/lib/useLatest';
import { Composer } from './Composer';
import { ThreadContent } from './ThreadContent';
import { canComment, type ThreadActor } from './permissions';
import type { ThreadActions } from './types';

export type PopoverCloseReason = 'escape' | 'outside';

export interface ThreadPopoverProps {
  thread: Thread;
  referenceEl: HTMLElement | null;
  /** floating 的邊界（viewer 容器） */
  boundary?: HTMLElement | null;
  /** 標記捲出可視區時隱藏卡片（保持掛載，保留未送出的輸入） */
  hidden?: boolean;
  actor: ThreadActor;
  actions: ThreadActions;
  canDelete: boolean;
  onDeleteMarkup: () => void;
  /** 點在這個元素內不算「點擊外部」（markup 畫布：點擊本來就會改變選取） */
  ignoreOutside?: HTMLElement | null;
  onClose: (reason: PopoverCloseReason) => void;
}

/**
 * 錨定在標記旁的討論串卡片。`@floating-ui/react`：placement right-start，offset(8)、flip()、shift({padding:8})；
 * `autoUpdate({animationFrame:true})` 讓卡片跟著標記（捲動）移動。
 * a11y：`role="dialog"`；開啟時焦點移入；Esc 關閉後焦點回到標記。
 */
export function ThreadPopover({
  thread,
  referenceEl,
  boundary,
  hidden = false,
  actor,
  actions,
  canDelete,
  onDeleteMarkup,
  ignoreOutside,
  onClose,
}: ThreadPopoverProps) {
  const closeRef = useLatest(onClose);
  const refEl = useLatest(referenceEl);

  const { refs, floatingStyles, context } = useFloating({
    open: !hidden,
    placement: 'right-start',
    elements: { reference: referenceEl },
    onOpenChange: (open, _event, reason) => {
      if (open) return;
      if (reason === 'escape-key') {
        closeRef.current('escape');
        refEl.current?.focus({ preventScroll: true });
      } else {
        closeRef.current('outside');
      }
    },
    middleware: [
      offset(8),
      flip(boundary ? { boundary } : {}),
      shift({ padding: 8, ...(boundary ? { boundary } : {}) }),
    ],
    whileElementsMounted: (reference, floating, update) =>
      autoUpdate(reference, floating, update, { animationFrame: true }),
  });
  const dismiss = useDismiss(context, {
    enabled: !hidden,
    outsidePressEvent: 'pointerdown',
    outsidePress: (e) =>
      !(ignoreOutside && e.target instanceof Node && ignoreOutside.contains(e.target)),
  });
  const { getFloatingProps } = useInteractions([dismiss]);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const setFloating = (el: HTMLDivElement | null) => {
    dialogRef.current = el;
    refs.setFloating(el);
  };

  // 開啟（或重新顯示）時把焦點移入卡片：優先輸入框，否則卡片本身。
  useEffect(() => {
    if (hidden) return;
    const root = dialogRef.current;
    if (!root) return;
    if (root.contains(document.activeElement)) return;
    const target = root.querySelector<HTMLElement>('textarea') ?? root;
    target.focus({ preventScroll: true });
  }, [hidden]);

  const label = thread.number !== null ? `標記 #${thread.number}` : '標記';
  const [confirming, setConfirming] = useState(false);
  const commentCount = thread.comments.length;
  const onDeleteClick = () => {
    if (commentCount > 0 && !confirming) {
      setConfirming(true);
      return;
    }
    onDeleteMarkup();
  };

  return (
    <div
      ref={setFloating}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      hidden={hidden}
      data-testid="thread-popover"
      style={{ ...floatingStyles, width: POPOVER_WIDTH_PX }}
      className="card pointer-events-auto z-30 max-h-[60vh] overflow-y-auto p-3 shadow-lg focus:outline-none"
      {...getFloatingProps()}
    >
      {commentCount > 0 || !canComment(actor) ? (
        <ThreadContent thread={thread} actor={actor} actions={actions} autoFocusReply />
      ) : (
        <Composer
          label="新增說明"
          placeholder="說明這個標記…（選填，支援 Markdown）"
          submitLabel="送出"
          autoFocus
          onSubmit={(b) => actions.onReply(thread, b)}
        />
      )}
      {canDelete && (
        <div className="mt-2 border-t border-line pt-2">
          <button type="button" onClick={onDeleteClick} className="btn btn-danger btn-sm">
            {confirming ? `確定刪除（含 ${commentCount} 則留言）` : '刪除標記'}
          </button>
        </div>
      )}
    </div>
  );
}
