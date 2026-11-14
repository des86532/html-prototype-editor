import type { Rect } from '@hpe/shared';
import { truncate } from '@/lib/format';

export interface HoverHighlightProps {
  /** agent 回報的 frame viewport 座標（unscaled CSS px） */
  rect: Rect | null;
  /** 描述（短 tag／文字）；frame 給的字串一律以純文字顯示並截斷 */
  label: string;
  scale: number;
  /** 圖形是否為拖曳中的 rubber band */
  frameOffset?: { x: number; y: number };
}

/** Comment 模式 hover 高亮框。畫在 parent overlay，不接收 pointer。 */
export function HoverHighlight({ rect, label, scale, frameOffset }: HoverHighlightProps) {
  if (!rect) return null;
  const ox = frameOffset?.x ?? 0;
  const oy = frameOffset?.y ?? 0;
  return (
    <div
      data-testid="hover-highlight"
      aria-hidden="true"
      className="pointer-events-none absolute border-2 border-measure bg-measure/10"
      style={{
        left: rect.x * scale + ox,
        top: rect.y * scale + oy,
        width: rect.w * scale,
        height: rect.h * scale,
      }}
    >
      {label && (
        <span className="absolute -top-5 left-[-2px] max-w-64 truncate rounded bg-measure px-1 text-[10px] text-white">
          {truncate(label, 80)}
        </span>
      )}
    </div>
  );
}
