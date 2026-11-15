import type { LiveState } from './useLiveSession';
import { peerColor } from './PresenceBar';

export interface CursorLayerProps {
  peers: LiveState['peers'];
  selfId: string | null;
  pageId: string | null;
  width: number;
  scroll: { x: number; y: number };
  frameSize: { w: number; h: number };
  scale: number;
}

/** 其他人的滑鼠：只畫同頁、同寬度、在可視範圍內的。 */
export function CursorLayer({
  peers,
  selfId,
  pageId,
  width,
  scroll,
  frameSize,
  scale,
}: CursorLayerProps) {
  const cursors = [];
  for (const p of peers.values()) {
    if (p.id === selfId || p.cursor === null || pageId === null) continue;
    if (p.pageId !== pageId || p.width !== width) continue;
    const dx = p.cursor.x - scroll.x;
    const dy = p.cursor.y - scroll.y;
    if (dx < 0 || dy < 0 || dx > frameSize.w || dy > frameSize.h) continue;
    const color = peerColor(p.colorKey);
    cursors.push(
      <div
        key={p.id}
        data-testid="live-cursor"
        data-peer-name={p.name}
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 transition-transform duration-75 ease-linear"
        style={{ transform: `translate(${dx * scale}px, ${dy * scale}px)` }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" className="block">
          <path d="M1 1 L1 13 L4.5 9.8 L7 15 L9 14 L6.6 9 L11.5 9 Z" fill={color} stroke="white" />
        </svg>
        <span
          className="ml-3 -mt-1 block w-max max-w-40 truncate rounded px-1.5 text-[11px] font-medium text-white"
          style={{ background: color }}
        >
          {p.name}
        </span>
      </div>,
    );
  }
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute left-0 top-0 overflow-hidden"
      style={{ width: frameSize.w * scale, height: frameSize.h * scale }}
    >
      {cursors}
    </div>
  );
}
