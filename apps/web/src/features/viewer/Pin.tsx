import type { Ref } from 'react';
import { PIN_SIZE_PX, initials, pinColor } from '@hpe/shared';
import { truncate } from '@/lib/format';
import type { PinItem } from './pinLayout';

/** 氣泡底部到尖端的距離（旋轉 45° 的 8px 方塊，半對角線約 5.7px）。 */
const TAIL_PX = 6;
const FALLBACK_COLOR = '#8b8d98';

export interface PinProps {
  item: PinItem;
  /** 卡片是否開啟（aria-expanded） */
  open: boolean;
  onClick: () => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
}

export function pinAriaLabel(item: PinItem): string {
  if (item.draft) return '新留言（草稿）';
  const state = item.resolved ? '（已解決）' : '';
  return `評論 #${item.number}：${truncate(item.summary.body.replace(/\s+/g, ' '), 60)}${state}`;
}

/**
 * 28px 氣泡（不隨 iframe scale 縮放），尾巴尖端落在標示點。
 * 狀態：fuzzy 虛線外框、fallback 灰色加警告、resolved 淡化、draft 半透明。
 */
export function Pin({ item, open, onClick, onPointerEnter, onPointerLeave, buttonRef }: PinProps) {
  const fallback = item.anchorStatus === 'fallback';
  const color = fallback ? FALLBACK_COLOR : pinColor(item.author);
  const half = PIN_SIZE_PX / 2;
  return (
    <div
      data-testid={item.draft ? 'pin-draft' : `pin-${item.id}`}
      data-pin-id={item.id}
      data-x={item.point.x}
      data-y={item.point.y}
      className="pointer-events-none absolute"
      style={{
        left: item.point.x - half,
        top: item.point.y - PIN_SIZE_PX - TAIL_PX,
        width: PIN_SIZE_PX,
        height: PIN_SIZE_PX,
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-label={pinAriaLabel(item)}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-status={item.anchorStatus}
        onClick={onClick}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        className={[
          'pointer-events-auto relative flex size-7 items-center justify-center rounded-full border-2 border-white text-[11px] font-semibold leading-none text-white shadow-md outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent',
          item.anchorStatus === 'fuzzy' ? 'outline-2 outline-dashed outline-ink' : '',
          item.draft ? 'opacity-50' : item.resolved ? 'opacity-60' : '',
          open ? 'ring-2 ring-accent' : '',
        ].join(' ')}
        style={{ backgroundColor: color }}
      >
        <span
          aria-hidden="true"
          className="absolute -bottom-1 left-1/2 -z-10 size-2 -translate-x-1/2 rotate-45"
          style={{ backgroundColor: color }}
        />
        <span aria-hidden="true">{item.draft ? '+' : initials(item.author.name)}</span>
        {!item.draft && (
          <span
            aria-hidden="true"
            className="absolute -right-3 -top-2 rounded bg-white px-0.5 text-[9px] font-bold text-ink shadow"
          >
            #{item.number}
          </span>
        )}
        {fallback && (
          <span
            aria-hidden="true"
            title="位置可能不準確"
            className="absolute -bottom-2 -left-2 rounded-full bg-warn-soft px-0.5 text-[9px] text-ink"
          >
            ⚠
          </span>
        )}
      </button>
    </div>
  );
}

/** 區域／文字評論的框（半透明），與 pin 分開畫在 overlay 上，不接收 pointer。 */
export function PinBox({ item }: { item: PinItem }) {
  if (!item.box) return null;
  const color = item.anchorStatus === 'fallback' ? FALLBACK_COLOR : pinColor(item.author);
  const text = item.kind === 'text';
  return (
    <div
      aria-hidden="true"
      data-testid={`pin-box-${item.id}`}
      data-kind={item.kind}
      className={[
        'pointer-events-none absolute',
        text ? '' : 'border-2',
        item.anchorStatus === 'fuzzy' ? 'border-dashed' : '',
        item.draft || item.resolved ? 'opacity-50' : '',
      ].join(' ')}
      style={{
        left: item.box.x,
        top: item.box.y,
        width: item.box.w,
        height: item.box.h,
        borderColor: color,
        backgroundColor: `color-mix(in srgb, ${color} ${text ? 35 : 15}%, transparent)`,
      }}
    />
  );
}
