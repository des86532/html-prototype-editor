import { useMemo, useRef } from 'react';
import type { PageInfo, Thread } from '@hpe/shared';
import { firstLines, formatRelativeTime, truncate } from '@/lib/format';

export interface MarkupPanelProps {
  threads: readonly Thread[];
  /** 依此順序分組；有 `<title>` 的頁面以標題顯示，否則顯示路徑。 */
  pages: readonly PageInfo[];
  showResolved: boolean;
  selectedId: string | null;
  onSelect: (thread: Thread) => void;
  onClose: () => void;
}

/** 標記面板（可收合的側欄）：只列附說明（有編號）的標記，依頁面分組。 */
export function MarkupPanel({
  threads,
  pages,
  showResolved,
  selectedId,
  onSelect,
  onClose,
}: MarkupPanelProps) {
  const listRef = useRef<HTMLDivElement>(null);

  const groups = useMemo(() => {
    const byPage = new Map<string, Thread[]>();
    for (const t of threads) {
      if (t.number === null) continue;
      if (!showResolved && t.status === 'resolved') continue;
      const list = byPage.get(t.markup.pageId);
      if (list) list.push(t);
      else byPage.set(t.markup.pageId, [t]);
    }
    const titles = new Map(pages.map((p) => [p.path, p.title]));
    const known = pages.map((p) => p.path);
    const order = [...known, ...Array.from(byPage.keys()).filter((p) => !titles.has(p))];
    return order
      .filter((p) => byPage.has(p))
      .map((p) => ({
        page: p,
        title: titles.get(p) ?? null,
        items: byPage.get(p)!.sort((a, b) => a.number! - b.number!),
      }));
  }, [threads, pages, showResolved]);

  const total = groups.reduce((n, g) => n + g.items.length, 0);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const rows = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>('[data-panel-row]') ?? [],
    );
    const i = rows.indexOf(document.activeElement as HTMLElement);
    if (i === -1) return;
    e.preventDefault();
    rows[e.key === 'ArrowDown' ? Math.min(rows.length - 1, i + 1) : Math.max(0, i - 1)]?.focus();
  };

  return (
    <aside
      aria-label="標記面板"
      data-testid="markup-panel"
      className="flex h-full w-80 shrink-0 flex-col border-l border-line bg-surface"
    >
      <header className="flex items-center justify-between border-b border-line px-3 py-2">
        <h2 className="text-sm font-semibold text-ink">
          標記（<span className="font-mono">{total}</span>）
        </h2>
        <button
          type="button"
          aria-label="收合標記面板"
          onClick={onClose}
          className="btn btn-ghost btn-sm"
        >
          ✕
        </button>
      </header>
      <div ref={listRef} onKeyDown={onKeyDown} className="min-h-0 flex-1 overflow-y-auto p-2">
        {total === 0 && <p className="px-2 py-4 text-sm text-ink-3">尚未有附說明的標記。</p>}
        {groups.map((g) => (
          <section key={g.page} className="mt-3 first:mt-0">
            <h3
              title={g.page}
              className="flex items-baseline gap-1.5 px-2 text-[11px] font-semibold tracking-wide text-ink-3"
            >
              {g.title ? (
                <>
                  <span className="min-w-0 truncate text-ink-2">{g.title}</span>
                  <span className="min-w-0 flex-1 truncate font-mono font-normal">{g.page}</span>
                </>
              ) : (
                <span className="break-all">{g.page}</span>
              )}
            </h3>
            <ul>
              {g.items.map((t) => {
                const first = t.comments[0];
                const open = selectedId === t.id;
                return (
                  <li key={t.id} className="py-1" data-thread-id={t.id}>
                    <button
                      type="button"
                      data-panel-row
                      aria-current={open ? 'true' : undefined}
                      onClick={() => onSelect(t)}
                      className={`flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-paper ${
                        open ? 'bg-accent-soft' : ''
                      }`}
                    >
                      <span className="flex items-center gap-2 text-xs text-ink-3">
                        <span className="font-mono font-semibold text-ink">#{t.number}</span>
                        <span className="chip chip-muted font-mono">
                          {t.markup.viewport.width}px
                        </span>
                        <span className="truncate">{t.createdBy.name}</span>
                        <span>{formatRelativeTime(t.createdAt)}</span>
                        {t.status === 'resolved' && <span className="chip chip-ok">已解決</span>}
                      </span>
                      <span className="line-clamp-2 whitespace-pre-wrap break-words text-sm">
                        {first ? truncate(firstLines(first.body, 2), 160) : ''}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </aside>
  );
}
