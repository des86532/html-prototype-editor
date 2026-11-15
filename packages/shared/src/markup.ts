import type { MarkupShape, MarkupStroke } from './types.js';

/** 標記的幾何（web 與 exporter 共用，沒有 DOM 依賴）。座標單位是頁面座標（CSS px）。 */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const FONT_SIZE: Record<MarkupStroke, number> = { 2: 14, 4: 20, 8: 28 };

export function textFontSize(stroke: MarkupStroke): number {
  return FONT_SIZE[stroke];
}

/** 以字元估算文字框：CJK（碼點 ≥ 0x2E80）算滿寬，其他算 0.6 寬。 */
export function textBox(text: string, fontSize: number): { w: number; h: number } {
  let w = 0;
  for (const ch of text) w += (ch.codePointAt(0) ?? 0) >= 0x2e80 ? fontSize : fontSize * 0.6;
  return { w, h: fontSize * 1.3 };
}

function pointsBox(points: readonly (readonly [number, number])[], pad: number): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}

export function shapeBounds(shape: MarkupShape): Box {
  switch (shape.kind) {
    case 'rect':
      return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
    case 'arrow':
      return pointsBox(
        [
          [shape.from.x, shape.from.y],
          [shape.to.x, shape.to.y],
        ],
        shape.stroke * 2,
      );
    case 'pen':
      return pointsBox(shape.points, shape.stroke);
    case 'highlighter':
      return pointsBox(shape.points, shape.stroke * 2);
    case 'text': {
      const b = textBox(shape.text, textFontSize(shape.stroke));
      return { x: shape.x, y: shape.y, w: b.w, h: b.h };
    }
  }
}
