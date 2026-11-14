import { useId } from 'react';
import type { ThreadFilters, ThreadStatus, ThreadTag } from '@hpe/shared';
import { TAG_LABELS } from '@/lib/format';

export interface FilterAuthor {
  id: string;
  name: string;
}

export interface FiltersProps {
  filters: ThreadFilters;
  onChange: (patch: Partial<ThreadFilters>) => void;
  /** bundle 內可選的頁面路徑 */
  pages: readonly string[];
  authors: readonly FilterAuthor[];
  /** 目前 viewer 的寬度（px），「只看目前寬度」用 */
  currentWidth: number;
}

const selectCls = 'input input-sm';

/** 狀態、頁面、寬度、作者、標籤。留言面板與畫面 pin 共用同一份 `ThreadFilters`。 */
export function Filters({ filters, onChange, pages, authors, currentWidth }: FiltersProps) {
  const id = useId();
  const field = (key: string, label: string, control: React.ReactNode) => (
    <div className="flex flex-col gap-0.5">
      <label htmlFor={`${id}-${key}`} className="text-[11px] text-ink-3">
        {label}
      </label>
      {control}
    </div>
  );
  return (
    <div role="group" aria-label="篩選" className="grid grid-cols-2 gap-2">
      {field(
        'status',
        '狀態',
        <select
          id={`${id}-status`}
          className={selectCls}
          value={filters.status}
          onChange={(e) => onChange({ status: e.target.value as ThreadStatus | 'all' })}
        >
          <option value="all">全部</option>
          <option value="open">未解決</option>
          <option value="resolved">已解決</option>
        </select>,
      )}
      {field(
        'page',
        '頁面',
        <select
          id={`${id}-page`}
          className={selectCls}
          value={filters.pageId ?? ''}
          onChange={(e) => onChange({ pageId: e.target.value === '' ? null : e.target.value })}
        >
          <option value="">全部頁面</option>
          {pages.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>,
      )}
      {field(
        'width',
        '寬度',
        <select
          id={`${id}-width`}
          className={selectCls}
          value={filters.width === null ? 'all' : 'current'}
          onChange={(e) => onChange({ width: e.target.value === 'current' ? currentWidth : null })}
        >
          <option value="all">全部</option>
          <option value="current">目前寬度（{Math.round(currentWidth)}px）</option>
        </select>,
      )}
      {field(
        'author',
        '作者',
        <select
          id={`${id}-author`}
          className={selectCls}
          value={filters.authorId ?? ''}
          onChange={(e) => onChange({ authorId: e.target.value === '' ? null : e.target.value })}
        >
          <option value="">全部作者</option>
          {authors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>,
      )}
      {field(
        'tag',
        '標籤',
        <select
          id={`${id}-tag`}
          className={selectCls}
          value={filters.tag ?? ''}
          onChange={(e) =>
            onChange({ tag: e.target.value === '' ? null : (e.target.value as ThreadTag) })
          }
        >
          <option value="">全部標籤</option>
          {(Object.keys(TAG_LABELS) as ThreadTag[]).map((t) => (
            <option key={t} value={t}>
              {TAG_LABELS[t]}
            </option>
          ))}
        </select>,
      )}
    </div>
  );
}
