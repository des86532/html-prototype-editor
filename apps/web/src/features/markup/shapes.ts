import { MARKUP_LIMITS, shapeBounds, type MarkupShape } from '@hpe/shared';

export const HIGHLIGHTER_WIDTH_FACTOR = 4;
export const HIGHLIGHTER_OPACITY = 0.35;
export const MIN_RECT_PX = 4;
export const MIN_ARROW_PX = 8;

/** 四捨五入到 0.1。 */
export function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** 所有座標平移，結果四捨五入到 0.1。 */
export function translateShape(shape: MarkupShape, dx: number, dy: number): MarkupShape {
  switch (shape.kind) {
    case 'rect':
    case 'text':
      return { ...shape, x: round1(shape.x + dx), y: round1(shape.y + dy) };
    case 'arrow':
      return {
        ...shape,
        from: { x: round1(shape.from.x + dx), y: round1(shape.from.y + dy) },
        to: { x: round1(shape.to.x + dx), y: round1(shape.to.y + dy) },
      };
    case 'pen':
    case 'highlighter':
      return {
        ...shape,
        points: shape.points.map(([x, y]) => [round1(x + dx), round1(y + dy)] as [number, number]),
      };
  }
}

/** 標記編號 badge 的位置：外框右上角。 */
export function badgePoint(shape: MarkupShape): { x: number; y: number } {
  const b = shapeBounds(shape);
  return { x: b.x + b.w, y: b.y };
}

/** 筆劃加點：距離上一點 < 2 或已達上限就不加。有加入時回傳 true。 */
export function appendPoint(points: [number, number][], x: number, y: number): boolean {
  if (points.length >= MARKUP_LIMITS.maxPoints) return false;
  const last = points[points.length - 1];
  if (last && Math.hypot(x - last[0], y - last[1]) < 2) return false;
  points.push([x, y]);
  return true;
}
