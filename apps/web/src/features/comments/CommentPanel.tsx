import { useMemo, useRef, useState } from 'react';
import {
  authorId,
  matchesFilters,
  type AnchorStatus,
  type Thread,
  type ThreadFilters,
} from '@hpe/shared';
import { firstLines, formatRelativeTime, truncate } from '@/lib/format';
import { Filters, type FilterAuthor } from './Filters';
import { ThreadContent } from './ThreadContent';
import type { ThreadActor } from './permissions';
import type { ThreadActions } from './types';

export interface PanelThread {
  thread: Thread;
  /** agent 解析結果；null = 尚未解析（不在目前頁面等） */
  anchorStatus: AnchorStatus | null;
}

export interface CommentPanelProps {
  items: readonly PanelThread[];
  filters: ThreadFilters;
  onFiltersChange: (patch: Partial<ThreadFilters>) => void;
  pages: readonly string[];
  currentWidth: number;
  /** 目前開啟卡片的 threadId */
  openId: string | null;
  /** 點擊一般項目：呼叫端切頁面／寬度、送 scrollToAnchor 並開啟卡片 */
  onSelect: (thread: Thread) => void;
  actor: ThreadActor;
  actions: ThreadActions;
  onClose: () => void;
}

/** hidden／orphaned 在畫面上沒有 pin：只能從面板查看與回覆，直接在面板內展開。 */
export function isPanelOnly(status: AnchorStatus | null): boolean {
  return status === 'hidden' || status === 'orphaned';
}

function stateHintText(t: Thread): string | null {
  const h = t.anchor.stateHint;
  if (!h) return null;
  const parts: string[] = [];
  if (h.hash) parts.push(`頁面狀態 ${h.hash}`);
  if (h.inDialog) parts.push('需開啟對話框（dialog／modal）');
  return parts.length ? parts.join('、') : null;
}

function Row({
  entry,
  open,
  expanded,
  onActivate,
  actor,
  actions,
}: {
  entry: PanelThread;
  open: boolean;
  expanded: boolean;
  onActivate: () => void;
  actor: ThreadActor;
  actions: ThreadActions;
}) {
  const { thread: t, anchorStatus } = entry;
  const first = t.comments[0];
  const hint = anchorStatus === 'hidden' ? stateHintText(t) : null;
  return (
    <li className="py-1" data-thread-id={t.id}>
      <button
        type="button"
        data-panel-row
        aria-current={open ? 'true' : undefined}
        aria-expanded={isPanelOnly(anchorStatus) ? expanded : undefined}
        onClick={onActivate}
        className={`flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-paper ${
          open ? 'bg-accent-soft' : ''
        }`}
      >
        <span className="flex items-center gap-2 text-xs text-ink-3">
          <span className="font-mono font-semibold text-ink">#{t.number}</span>
          <span className="truncate">{t.createdBy.name}</span>
          <span>{formatRelativeTime(t.createdAt)}</span>
          {t.status === 'resolved' && <span className="chip chip-ok">已解決</span>}
          {anchorStatus === 'hidden' && <span className="chip chip-muted">目前狀態不可見</span>}
          {anchorStatus === 'fuzzy' && <span className="chip chip-warn">位置可能有變</span>}
          {anchorStatus === 'fallback' && <span className="chip chip-muted">位置不準確</span>}
        </span>
        <span className="line-clamp-2 whitespace-pre-wrap break-words text-sm">
          {first ? truncate(firstLines(first.body, 2), 160) : ''}
        </span>
        <span className="text-[11px] text-ink-3">
          {t.anchor.pageId}・{Math.round(t.anchor.viewport.width)}px
          {t.comments.length > 1 ? `・${t.comments.length - 1} 則回覆` : ''}
        </span>
      </button>
      {expanded && (
        <div className="mt-1 rounded-md border border-line p-2">
          {hint && <p className="mb-2 text-xs text-ink-2">{hint}</p>}
          <ThreadContent thread={t} actor={actor} actions={actions} />
        </div>
      )}
    </li>
  );
}

/**
 * 留言面板（可收合的側欄）：總覽、篩選，以及畫面上看不到的留言（hidden／orphaned）。
 * 完整鍵盤操作：項目是 button，↑/↓ 在項目之間移動焦點。
 */
export function CommentPanel({
  items,
  filters,
  onFiltersChange,
  pages,
  currentWidth,
  openId,
  onSelect,
  actor,
  actions,
  onClose,
}: CommentPanelProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const listRef = useRef<HTMLDivElement>(null);

  const authors = useMemo<FilterAuthor[]>(() => {
    const m = new Map<string, string>();
    for (const { thread } of items) m.set(authorId(thread.createdBy), thread.createdBy.name);
    return Array.from(m, ([id, name]) => ({ id, name }));
  }, [items]);

  const { normal, hidden, orphaned } = useMemo(() => {
    const visible = items
      .filter(({ thread }) => matchesFilters(thread, filters))
      .sort((a, b) => a.thread.number - b.thread.number);
    return {
      normal: visible.filter((e) => !isPanelOnly(e.anchorStatus)),
      hidden: visible.filter((e) => e.anchorStatus === 'hidden'),
      orphaned: visible.filter((e) => e.anchorStatus === 'orphaned'),
    };
  }, [items, filters]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const renderGroup = (title: string, list: PanelThread[], testId: string) =>
    list.length === 0 ? null : (
      <section aria-label={title} data-testid={testId} className="mt-3">
        <h3 className="px-2 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
          {title}（{list.length}）
        </h3>
        <ul>
          {list.map((entry) => {
            const panelOnly = isPanelOnly(entry.anchorStatus);
            return (
              <Row
                key={entry.thread.id}
                entry={entry}
                open={openId === entry.thread.id}
                expanded={panelOnly && expanded.has(entry.thread.id)}
                onActivate={() => (panelOnly ? toggle(entry.thread.id) : onSelect(entry.thread))}
                actor={actor}
                actions={actions}
              />
            );
          })}
        </ul>
      </section>
    );

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

  const total = normal.length + hidden.length + orphaned.length;

  return (
    <aside
      aria-label="留言面板"
      data-testid="comment-panel"
      className="flex h-full w-80 shrink-0 flex-col border-l border-line bg-surface"
    >
      <header className="flex items-center justify-between border-b border-line px-3 py-2">
        <h2 className="text-sm font-semibold text-ink">
          留言（<span className="font-mono">{total}</span>）
        </h2>
        <button
          type="button"
          aria-label="收合留言面板"
          onClick={onClose}
          className="btn btn-ghost btn-sm"
        >
          ✕
        </button>
      </header>
      <div className="border-b border-line p-3">
        <Filters
          filters={filters}
          onChange={onFiltersChange}
          pages={pages}
          authors={authors}
          currentWidth={currentWidth}
        />
      </div>
      <div ref={listRef} onKeyDown={onKeyDown} className="min-h-0 flex-1 overflow-y-auto p-2">
        {total === 0 && <p className="px-2 py-4 text-sm text-ink-3">沒有符合條件的留言。</p>}
        {renderGroup('所有討論串', normal, 'panel-group-normal')}
        {renderGroup('目前狀態不可見', hidden, 'panel-group-hidden')}
        {renderGroup('孤兒評論', orphaned, 'panel-group-orphaned')}
      </div>
    </aside>
  );
}
