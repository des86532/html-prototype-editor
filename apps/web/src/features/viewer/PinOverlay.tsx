import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { initials, pinColor, FRAME_TIMINGS } from '@hpe/shared';
import { Pin, PinBox, pinAriaLabel } from './Pin';
import { PinPreview } from './PinPreview';
import { edgeIndicator, isPointInView, type PinItem, type Size } from './pinLayout';

export interface PinCardArgs {
  pin: PinItem;
  /** pin 按鈕（卡片的 floating reference）；pin 在可視區外時為 null */
  referenceEl: HTMLElement | null;
  /** pin 捲出可視區：卡片需隱藏（但保持掛載以保留輸入內容） */
  hidden: boolean;
}

export interface PinOverlayProps {
  pins: readonly PinItem[];
  /** frame 可視區（螢幕 px：寬高已乘 scale） */
  viewport: Size;
  openId: string | null;
  onPinClick: (id: string) => void;
  /** 點擊邊緣箭頭：呼叫端送 scrollToAnchor 並重新開啟卡片 */
  onEdgeClick: (id: string) => void;
  /** 卡片插槽（ThreadPopover） */
  renderCard?: (args: PinCardArgs) => ReactNode;
  /** floating 元素（預覽卡）的邊界，預設為 viewport */
  boundary?: HTMLElement | null;
  hoverDelayMs?: number;
}

const ARROWS = { top: '↑', bottom: '↓', left: '←', right: '→' } as const;

interface SlotProps {
  pin: PinItem;
  inView: boolean;
  open: boolean;
  viewport: Size;
  onPinClick: (id: string) => void;
  onEdgeClick: (id: string) => void;
  renderCard?: PinOverlayProps['renderCard'];
  boundary?: HTMLElement | null;
  hoverDelayMs: number;
}

function PinSlot({
  pin,
  inView,
  open,
  viewport,
  onPinClick,
  onEdgeClick,
  renderCard,
  boundary,
  hoverDelayMs,
}: SlotProps) {
  const [el, setEl] = useState<HTMLButtonElement | null>(null);
  const [hovering, setHovering] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => clear, [clear]);

  const enter = () => {
    clear();
    timer.current = setTimeout(() => setHovering(true), hoverDelayMs);
  };
  const leave = () => {
    clear();
    setHovering(false);
  };

  if (!inView) {
    const edge = edgeIndicator(pin.point, viewport);
    const color = pinColor(pin.author);
    return (
      <>
        <button
          type="button"
          data-testid={`edge-${pin.id}`}
          data-side={edge.side}
          aria-label={`${pinAriaLabel(pin)}（在畫面外，點擊捲動到該位置）`}
          onClick={() => onEdgeClick(pin.id)}
          className="pointer-events-auto absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-0.5 rounded-full border border-white px-1.5 py-0.5 text-[11px] font-semibold text-white shadow-md"
          style={{ left: edge.x, top: edge.y, backgroundColor: color }}
        >
          <span aria-hidden="true">{ARROWS[edge.side]}</span>
          <span aria-hidden="true">{pin.draft ? '+' : initials(pin.author.name)}</span>
          {!pin.draft && <span aria-hidden="true">#{pin.number}</span>}
        </button>
        {open && renderCard?.({ pin, referenceEl: null, hidden: true })}
      </>
    );
  }

  return (
    <>
      <Pin
        item={pin}
        open={open}
        buttonRef={setEl}
        onClick={() => {
          leave();
          onPinClick(pin.id);
        }}
        onPointerEnter={enter}
        onPointerLeave={leave}
      />
      {hovering && !open && !pin.draft && (
        <PinPreview summary={pin.summary} referenceEl={el} boundary={boundary} />
      )}
      {open && renderCard?.({ pin, referenceEl: el, hidden: false })}
    </>
  );
}

/**
 * 蓋在 frame 上的 overlay。`pointer-events: none`，只有 pin、卡片與邊緣箭頭接收 pointer，
 * 所以兩種模式下 pin 都可點擊，其餘區域的點擊直接落到 prototype。
 */
export function PinOverlay({
  pins,
  viewport,
  openId,
  onPinClick,
  onEdgeClick,
  renderCard,
  boundary,
  hoverDelayMs = FRAME_TIMINGS.hoverPreviewDelayMs,
}: PinOverlayProps) {
  return (
    <div data-testid="pin-overlay" className="pointer-events-none absolute inset-0 z-20">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {pins.map((pin) => (
          <PinBox key={`box-${pin.id}`} item={pin} />
        ))}
      </div>
      {pins.map((pin) => (
        <PinSlot
          key={pin.id}
          pin={pin}
          inView={isPointInView(pin.point, viewport)}
          open={openId === pin.id}
          viewport={viewport}
          onPinClick={onPinClick}
          onEdgeClick={onEdgeClick}
          renderCard={renderCard}
          boundary={boundary}
          hoverDelayMs={hoverDelayMs}
        />
      ))}
    </div>
  );
}
