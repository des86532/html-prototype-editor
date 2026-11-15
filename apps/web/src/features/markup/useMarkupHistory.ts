import { useCallback, useEffect, useRef, useState } from 'react';
import type { Markup, MarkupShape } from '@hpe/shared';

export type HistoryEntry =
  | { kind: 'create'; threadId: string }
  | { kind: 'move'; threadId: string; before: MarkupShape }
  | { kind: 'delete'; markup: Markup };

const MAX_ENTRIES = 50;

/** 標記操作的復原堆疊（最多 50 筆）。復原的套用由 viewer 負責。版本改變時清空。 */
export function useMarkupHistory(versionId: string) {
  const stack = useRef<HistoryEntry[]>([]);
  const [canUndo, setCanUndo] = useState(false);

  useEffect(() => {
    stack.current = [];
    setCanUndo(false);
  }, [versionId]);

  const push = useCallback((e: HistoryEntry) => {
    stack.current.push(e);
    if (stack.current.length > MAX_ENTRIES) stack.current.shift();
    setCanUndo(true);
  }, []);

  const undo = useCallback((): HistoryEntry | null => {
    const e = stack.current.pop() ?? null;
    setCanUndo(stack.current.length > 0);
    return e;
  }, []);

  /** 樂觀建立的 tmp id 換成伺服器 id。 */
  const replaceId = useCallback((tmpId: string, realId: string) => {
    stack.current = stack.current.map((e) =>
      e.kind !== 'delete' && e.threadId === tmpId ? { ...e, threadId: realId } : e,
    );
  }, []);

  return { push, undo, canUndo, replaceId };
}
