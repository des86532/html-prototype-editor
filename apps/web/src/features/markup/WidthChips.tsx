import { useMemo } from 'react';
import type { Thread } from '@hpe/shared';

export interface WidthChipsProps {
  threads: readonly Thread[];
  pageId: string | null;
  width: number;
  showResolved: boolean;
  onPick: (width: number, height: number) => void;
}

/** 目前頁面在其他寬度畫的標記：每個寬度一顆 chip，點了切到該寬度。 */
export function WidthChips({ threads, pageId, width, showResolved, onPick }: WidthChipsProps) {
  const groups = useMemo(() => {
    const m = new Map<number, { count: number; height: number }>();
    if (pageId === null) return [];
    for (const t of threads) {
      if (t.markup.pageId !== pageId || t.markup.viewport.width === width) continue;
      if (!showResolved && t.status === 'resolved') continue;
      const w = t.markup.viewport.width;
      const g = m.get(w);
      if (g) g.count += 1;
      else m.set(w, { count: 1, height: t.markup.viewport.height });
    }
    return Array.from(m, ([w, g]) => ({ w, ...g })).sort((a, b) => b.w - a.w);
  }, [threads, pageId, width, showResolved]);

  if (groups.length === 0) return null;
  return (
    <div className="card absolute bottom-3 left-1/2 z-20 -translate-x-1/2 flex items-center gap-1.5 px-2 py-1 text-xs shadow">
      <span className="text-ink-2">其他寬度有標記：</span>
      {groups.map((g) => (
        <button
          key={g.w}
          type="button"
          onClick={() => onPick(g.w, g.height)}
          className="btn btn-secondary btn-sm font-mono"
        >
          {g.w}px（{g.count}）
        </button>
      ))}
    </div>
  );
}
