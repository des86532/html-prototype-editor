import { useCallback, useMemo } from 'react';
import type { Anchor, Rect, Thread } from '@hpe/shared';
import { PinOverlay, type PinCardArgs } from './PinOverlay';
import { buildPins, type AnchorResult } from './buildPins';
import type { Point, Size } from './pinLayout';
import { ThreadPopover } from '@/features/comments/ThreadPopover';
import type { ThreadActor } from '@/features/comments/permissions';
import type { ThreadActions } from '@/features/comments/types';
import { DRAFT_ID, useUiStore } from '@/state/uiStore';

export interface ThreadLayerProps {
  threads: readonly Thread[];
  actions: ThreadActions;
  /** 建立 thread（reject 時 message 已可顯示） */
  createThread: (anchor: Anchor, body: string) => Promise<Thread>;
  actor: ThreadActor;
  pagePaths: readonly string[];
  currentPageId: string | null;
  scale: number;
  /** frame 目前的 viewport（unscaled CSS px） */
  frameViewport: Size;
  frameOffset?: Point;
  rects: Readonly<Record<string, Rect | null | undefined>>;
  results: Readonly<Record<string, AnchorResult | undefined>>;
  boundary: HTMLElement | null;
  /** 送 scrollToAnchor */
  onScrollTo: (threadId: string) => void;
  /** 草稿轉正式：呼叫端把草稿的 rect／解析結果搬給新 thread，避免 pin 閃爍 */
  onDraftPromoted?: (threadId: string) => void;
}

/**
 * Container：把 store（模式／顯示控制／草稿／開啟的卡片）、threads 與 geometry 組成 PinOverlay + ThreadPopover。
 * 草稿流程：點擊 → 草稿 pin + inline Composer；送出 → 建立 thread、卡片保持開啟；
 * 空內容／Esc／點擊外部 → 捨棄草稿（不呼叫 API）。
 */
export function ThreadLayer({
  threads,
  actions,
  createThread,
  actor,
  pagePaths,
  currentPageId,
  scale,
  frameViewport,
  frameOffset,
  rects,
  results,
  boundary,
  onScrollTo,
  onDraftPromoted,
}: ThreadLayerProps) {
  const showComments = useUiStore((s) => s.showComments);
  const showResolved = useUiStore((s) => s.showResolved);
  const filters = useUiStore((s) => s.filters);
  const openThreadId = useUiStore((s) => s.openThreadId);
  const draft = useUiStore((s) => s.draft);

  const pins = useMemo(
    () =>
      buildPins({
        threads,
        rects,
        results,
        pagePaths,
        currentPageId,
        scale,
        frameOffset,
        showResolved,
        filters,
        openThreadId,
        draft,
        me: actor.me,
      }),
    [
      threads,
      rects,
      results,
      pagePaths,
      currentPageId,
      scale,
      frameOffset,
      showResolved,
      filters,
      openThreadId,
      draft,
      actor.me,
    ],
  );

  const openId = draft ? DRAFT_ID : openThreadId;

  const onPinClick = useCallback((id: string) => {
    const s = useUiStore.getState();
    if (id === DRAFT_ID) return;
    s.openThread(s.openThreadId === id ? null : id);
  }, []);

  const onEdgeClick = useCallback(
    (id: string) => {
      onScrollTo(id);
      if (id !== DRAFT_ID) useUiStore.getState().openThread(id);
    },
    [onScrollTo],
  );

  const renderCard = useCallback(
    ({ pin, referenceEl, hidden }: PinCardArgs) => {
      if (pin.draft) {
        const d = useUiStore.getState().draft;
        return (
          <ThreadPopover
            thread={null}
            referenceEl={referenceEl}
            boundary={boundary}
            hidden={hidden}
            actor={actor}
            actions={actions}
            draft={{
              onSubmit: async (body) => {
                if (!d) return;
                const thread = await createThread(d.anchor, body);
                onDraftPromoted?.(thread.id);
                useUiStore.getState().openThread(thread.id);
              },
              onDiscard: () => useUiStore.getState().clearDraft(),
            }}
            onClose={() => useUiStore.getState().clearDraft()}
          />
        );
      }
      const thread = threads.find((t) => t.id === pin.id);
      if (!thread) return null;
      return (
        <ThreadPopover
          thread={thread}
          anchorStatus={pin.anchorStatus}
          referenceEl={referenceEl}
          boundary={boundary}
          hidden={hidden}
          actor={actor}
          actions={actions}
          onClose={() => useUiStore.getState().openThread(null)}
        />
      );
    },
    [threads, actor, actions, boundary, createThread, onDraftPromoted],
  );

  if (!showComments) return null;

  return (
    <PinOverlay
      pins={pins}
      viewport={{ w: frameViewport.w * scale, h: frameViewport.h * scale }}
      openId={openId}
      onPinClick={onPinClick}
      onEdgeClick={onEdgeClick}
      renderCard={renderCard}
      boundary={boundary}
    />
  );
}
