import { useMemo } from 'react';
import { PIN_SIZE_PX, pinPoint, type AnchorStatus, type Author, type Rect } from '@hpe/shared';

export type PinKind = 'element' | 'region' | 'text';
export interface Point {
  x: number;
  y: number;
}
export interface Size {
  w: number;
  h: number;
}

/** 一個 pin 的呈現資料（presentational：不含 thread 本身，也不含任何 store／API）。 */
export interface PinItem {
  /** threadId；草稿使用 `DRAFT_ID` */
  id: string;
  number: number | null;
  author: Author;
  kind: PinKind;
  anchorStatus: AnchorStatus;
  draft: boolean;
  resolved: boolean;
  /** 標示點（尖端），單位：overlay 的螢幕 px（已含 scale 與 frame offset） */
  point: Point;
  /** 區域／文字評論的框，overlay 螢幕 px */
  box: Rect | null;
  /** hover 預覽與 aria-label 使用的摘要（純文字） */
  summary: { authorName: string; createdAt: string; body: string; replyCount: number };
}

/** 輸入給 `usePinPosition`：agent 回報的 viewport rect 與錨點資訊。 */
export interface PinSource {
  id: string;
  kind: PinKind;
  elementOffset: Point;
  rect: Rect | null;
}

export interface PinGeometry {
  point: Point;
  box: Rect | null;
}

/** 規格「Pin 位置公式」。rect 為 frame viewport 座標（unscaled CSS px）。 */
export function computePinGeometry(
  src: PinSource,
  scale: number,
  frameOffset: Point = { x: 0, y: 0 },
): PinGeometry | null {
  if (!src.rect) return null;
  const point = pinPoint(src.kind, src.rect, src.elementOffset, scale, frameOffset);
  const box: Rect | null =
    src.kind === 'element'
      ? null
      : {
          x: src.rect.x * scale + frameOffset.x,
          y: src.rect.y * scale + frameOffset.y,
          w: src.rect.w * scale,
          h: src.rect.h * scale,
        };
  return { point, box };
}

/** pin 位置會隨 geometry／scale／offset 更新（捲動、resize 都會經 geometry 進來）。 */
export function usePinPosition(
  sources: readonly PinSource[],
  scale: number,
  frameOffset: Point,
): Map<string, PinGeometry> {
  const { x, y } = frameOffset;
  return useMemo(() => {
    const out = new Map<string, PinGeometry>();
    for (const s of sources) {
      const g = computePinGeometry(s, scale, { x, y });
      if (g) out.set(s.id, g);
    }
    return out;
  }, [sources, scale, x, y]);
}

/** 標示點是否在可視區（螢幕 px）內。 */
export function isPointInView(p: Point, view: Size, margin = 0): boolean {
  return p.x >= -margin && p.y >= -margin && p.x <= view.w + margin && p.y <= view.h + margin;
}

export type EdgeSide = 'top' | 'bottom' | 'left' | 'right';

export interface EdgeIndicator {
  x: number;
  y: number;
  side: EdgeSide;
}

const EDGE_INSET = PIN_SIZE_PX / 2 + 4;

/** pin 在可視區外時，箭頭貼在最近的邊緣上。 */
export function edgeIndicator(p: Point, view: Size): EdgeIndicator {
  const clampX = Math.min(Math.max(p.x, EDGE_INSET), Math.max(EDGE_INSET, view.w - EDGE_INSET));
  const clampY = Math.min(Math.max(p.y, EDGE_INSET), Math.max(EDGE_INSET, view.h - EDGE_INSET));
  const dx = p.x < 0 ? -p.x : p.x > view.w ? p.x - view.w : 0;
  const dy = p.y < 0 ? -p.y : p.y > view.h ? p.y - view.h : 0;
  if (dy >= dx)
    return {
      x: clampX,
      y: p.y < 0 ? EDGE_INSET : view.h - EDGE_INSET,
      side: p.y < 0 ? 'top' : 'bottom',
    };
  return {
    x: p.x < 0 ? EDGE_INSET : view.w - EDGE_INSET,
    y: clampY,
    side: p.x < 0 ? 'left' : 'right',
  };
}
