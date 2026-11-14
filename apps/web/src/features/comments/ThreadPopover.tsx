import { useEffect, useRef } from 'react';
import {
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
} from '@floating-ui/react';
import { POPOVER_WIDTH_PX, type AnchorStatus, type Thread } from '@hpe/shared';
import { useLatest } from '@/lib/useLatest';
import { Composer } from './Composer';
import { ThreadContent } from './ThreadContent';
import type { ThreadActor } from './permissions';
import type { ThreadActions } from './types';

export type PopoverCloseReason = 'escape' | 'outside';

export interface DraftHandlers {
  onSubmit: (body: string) => Promise<void> | void;
  /** 空內容送出、Esc、點擊外部：捨棄草稿，不呼叫 API */
  onDiscard: () => void;
}

export interface ThreadPopoverProps {
  /** null = 草稿（只顯示 Composer） */
  thread: Thread | null;
  anchorStatus?: AnchorStatus;
  referenceEl: HTMLElement | null;
  /** floating 的邊界（viewer 容器） */
  boundary?: HTMLElement | null;
  /** pin 捲出可視區時隱藏卡片（保持掛載，保留未送出的輸入） */
  hidden?: boolean;
  actor: ThreadActor;
  actions: ThreadActions;
  draft?: DraftHandlers;
  onClose: (reason: PopoverCloseReason) => void;
}

/**
 * 錨定在 pin 旁的討論串卡片。`@floating-ui/react`：placement right-start，offset(8)、flip()、shift({padding:8})；
 * `autoUpdate({animationFrame:true})` 讓卡片跟著 pin（geometry／捲動）移動。
 * a11y：`role="dialog"`；開啟時焦點移入；Esc 關閉後焦點回到 pin。
 */
export function ThreadPopover({
  thread,
  anchorStatus,
  referenceEl,
  boundary,
  hidden = false,
  actor,
  actions,
  draft,
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
  const dismiss = useDismiss(context, { enabled: !hidden, outsidePressEvent: 'pointerdown' });
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

  const label = thread ? `評論 #${thread.number} 討論串` : '新增留言';

  return (
    <div
      ref={setFloating}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      hidden={hidden}
      data-testid="thread-popover"
      data-draft={thread ? undefined : 'true'}
      style={{ ...floatingStyles, width: POPOVER_WIDTH_PX }}
      className="card pointer-events-auto z-30 max-h-[60vh] overflow-y-auto p-3 shadow-lg focus:outline-none"
      {...getFloatingProps()}
    >
      {thread ? (
        <>
          {(anchorStatus === 'fuzzy' || anchorStatus === 'fallback') && (
            <p className="mb-2 rounded border border-warn/30 bg-warn-soft px-2 py-1 text-xs text-warn">
              {anchorStatus === 'fuzzy' ? '位置可能有變' : '找不到原本的元素，位置可能不準確'}
            </p>
          )}
          <ThreadContent thread={thread} actor={actor} actions={actions} autoFocusReply />
        </>
      ) : (
        <Composer
          label="新增留言"
          placeholder="新增留言…（支援 Markdown）"
          autoFocus
          onSubmit={(body) => draft?.onSubmit(body)}
          onEmptySubmit={() => draft?.onDiscard()}
        />
      )}
    </div>
  );
}
