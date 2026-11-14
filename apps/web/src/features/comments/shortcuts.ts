import { useEffect, useRef } from 'react';

export interface ShortcutContext {
  canComment: boolean;
  /** 畫面上有 pin 的討論串（依編號排序），J/K 在其中移動 */
  navigableIds: readonly string[];
  openId: string | null;
  hasDraft: boolean;
  toggleMode: () => void;
  toggleShowComments: () => void;
  /** Esc：捨棄草稿，或關閉卡片 */
  escape: () => void;
  openThread: (id: string) => void;
  toggleResolveOpen: () => void;
}

export function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** 回傳 true 代表事件已處理（呼叫端會 preventDefault）。 */
export function handleShortcut(
  e: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey' | 'target'>,
  ctx: ShortcutContext,
): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (isEditableTarget(e.target)) return false;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  switch (key) {
    case 'c':
      if (e.shiftKey) ctx.toggleShowComments();
      else if (ctx.canComment) ctx.toggleMode();
      else return false;
      return true;
    case 'Escape':
      if (!ctx.hasDraft && ctx.openId === null) return false;
      ctx.escape();
      return true;
    case 'j':
    case 'k': {
      if (ctx.navigableIds.length === 0) return false;
      const ids = ctx.navigableIds;
      const i = ctx.openId === null ? -1 : ids.indexOf(ctx.openId);
      const next =
        key === 'j'
          ? ids[i === -1 ? 0 : Math.min(ids.length - 1, i + 1)]
          : ids[i === -1 ? ids.length - 1 : Math.max(0, i - 1)];
      if (next === undefined) return false;
      ctx.openThread(next);
      return true;
    }
    case 'r':
      if (!ctx.canComment || ctx.openId === null) return false;
      ctx.toggleResolveOpen();
      return true;
    default:
      return false;
  }
}

/** 全域快捷鍵（輸入框內的按鍵一律忽略）。 */
export function useViewerShortcuts(ctx: ShortcutContext): void {
  const ref = useRef(ctx);
  ref.current = ctx;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (handleShortcut(e, ref.current)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
