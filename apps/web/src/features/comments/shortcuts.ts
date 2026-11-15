import { useEffect, useRef } from 'react';
import type { MarkupTool } from '@hpe/shared';
import type { ViewerMode } from '@/state/uiStore';

export interface ShortcutContext {
  canMarkup: boolean;
  mode: ViewerMode;
  /** 畫面上有編號的標記（依編號排序），J/K 在其中移動 */
  navigableIds: readonly string[];
  selectedId: string | null;
  toggleMode: () => void;
  toggleShowMarkups: () => void;
  /** Esc：先取消選取，沒有選取時離開標記模式；回傳是否有處理 */
  escape: () => boolean;
  select: (id: string) => void;
  setTool: (tool: MarkupTool | 'select') => void;
  deleteSelected: () => void;
  undo: () => void;
}

const TOOL_KEYS: Record<string, MarkupTool | 'select'> = {
  v: 'select',
  r: 'rect',
  a: 'arrow',
  p: 'pen',
  h: 'highlighter',
  t: 'text',
};

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
  if (isEditableTarget(e.target)) return false;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (e.ctrlKey || e.metaKey) {
    if (key === 'z' && !e.shiftKey && !e.altKey && ctx.canMarkup) {
      ctx.undo();
      return true;
    }
    return false;
  }
  if (e.altKey) return false;
  switch (key) {
    case 'c':
      if (e.shiftKey) ctx.toggleShowMarkups();
      else if (ctx.canMarkup) ctx.toggleMode();
      else return false;
      return true;
    case 'Escape':
      return ctx.escape();
    case 'j':
    case 'k': {
      if (ctx.navigableIds.length === 0) return false;
      const ids = ctx.navigableIds;
      const i = ctx.selectedId === null ? -1 : ids.indexOf(ctx.selectedId);
      const next =
        key === 'j'
          ? ids[i === -1 ? 0 : Math.min(ids.length - 1, i + 1)]
          : ids[i === -1 ? ids.length - 1 : Math.max(0, i - 1)];
      if (next === undefined) return false;
      ctx.select(next);
      return true;
    }
    case 'Delete':
    case 'Backspace':
      if (ctx.selectedId === null) return false;
      ctx.deleteSelected();
      return true;
    default: {
      const tool = ctx.mode === 'markup' && !e.shiftKey ? TOOL_KEYS[key] : undefined;
      if (!tool) return false;
      ctx.setTool(tool);
      return true;
    }
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
