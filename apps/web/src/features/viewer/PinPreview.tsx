import { autoUpdate, flip, offset, shift, useFloating } from '@floating-ui/react';
import { firstLines, formatRelativeTime } from '@/lib/format';
import type { PinItem } from './pinLayout';

export interface PinPreviewProps {
  summary: PinItem['summary'];
  referenceEl: HTMLElement | null;
  boundary?: HTMLElement | null;
}

/** hover 預覽：作者、時間、第一則留言前 2 行、回覆數。全部以文字節點渲染（不解析 markdown）。 */
export function PinPreview({ summary, referenceEl, boundary }: PinPreviewProps) {
  const {
    refs: { setFloating },
    floatingStyles,
  } = useFloating({
    placement: 'right-start',
    elements: { reference: referenceEl },
    middleware: [
      offset(8),
      flip(boundary ? { boundary } : {}),
      shift({ padding: 8, ...(boundary ? { boundary } : {}) }),
    ],
    whileElementsMounted: autoUpdate,
  });
  return (
    <div
      ref={setFloating}
      role="tooltip"
      data-testid="pin-preview"
      style={floatingStyles}
      className="card pointer-events-none z-30 w-64 p-3 text-sm shadow-lg"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-semibold text-ink">{summary.authorName}</span>
        <span className="shrink-0 text-xs text-ink-3">{formatRelativeTime(summary.createdAt)}</span>
      </div>
      <p className="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-ink-2">
        {firstLines(summary.body, 2)}
      </p>
      <p className="mt-1 text-xs text-ink-3">
        {summary.replyCount > 0 ? `${summary.replyCount} 則回覆` : '尚無回覆'}
      </p>
    </div>
  );
}
