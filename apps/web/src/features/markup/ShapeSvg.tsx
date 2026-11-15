import { memo } from 'react';
import { shapeBounds, textFontSize, type MarkupShape } from '@hpe/shared';
import { HIGHLIGHTER_OPACITY, HIGHLIGHTER_WIDTH_FACTOR } from './shapes';

const ARROW_SPREAD = (28 * Math.PI) / 180;

function arrowGeometry(
  from: { x: number; y: number },
  to: { x: number; y: number },
  stroke: number,
) {
  const head = stroke * 3 + 6;
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  const shorten = Math.min(len, head * 0.8);
  const end = { x: to.x - Math.cos(angle) * shorten, y: to.y - Math.sin(angle) * shorten };
  const wing = (sign: 1 | -1) =>
    `${to.x - head * Math.cos(angle + sign * ARROW_SPREAD)},${to.y - head * Math.sin(angle + sign * ARROW_SPREAD)}`;
  return { end, head: `${to.x},${to.y} ${wing(1)} ${wing(-1)}` };
}

const pointsAttr = (points: readonly (readonly [number, number])[]) =>
  points.map(([x, y]) => `${x},${y}`).join(' ');

/** 單一標記的 SVG（頁面座標）。內容全是 React 屬性與純文字節點。 */
export const ShapeSvg = memo(function ShapeSvg({
  shape,
  selected,
  hitArea,
}: {
  shape: MarkupShape;
  selected: boolean;
  hitArea: boolean;
}) {
  const common = {
    fill: 'none',
    stroke: shape.color,
    strokeWidth: shape.stroke,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  } as const;
  const hit = (width: number) =>
    ({
      fill: 'none',
      stroke: 'transparent',
      strokeWidth: Math.max(12, width + 8),
      pointerEvents: 'stroke',
    }) as const;

  let body: React.ReactNode;
  switch (shape.kind) {
    case 'rect':
      body = (
        <>
          <rect x={shape.x} y={shape.y} width={shape.w} height={shape.h} {...common} />
          {hitArea && (
            <rect x={shape.x} y={shape.y} width={shape.w} height={shape.h} {...hit(shape.stroke)} />
          )}
        </>
      );
      break;
    case 'arrow': {
      const g = arrowGeometry(shape.from, shape.to, shape.stroke);
      body = (
        <>
          <line x1={shape.from.x} y1={shape.from.y} x2={g.end.x} y2={g.end.y} {...common} />
          <polygon points={g.head} {...common} fill={shape.color} />
          {hitArea && (
            <line
              x1={shape.from.x}
              y1={shape.from.y}
              x2={shape.to.x}
              y2={shape.to.y}
              {...hit(shape.stroke)}
            />
          )}
        </>
      );
      break;
    }
    case 'pen':
      body = (
        <>
          <polyline points={pointsAttr(shape.points)} {...common} />
          {hitArea && <polyline points={pointsAttr(shape.points)} {...hit(shape.stroke)} />}
        </>
      );
      break;
    case 'highlighter': {
      const width = shape.stroke * HIGHLIGHTER_WIDTH_FACTOR;
      body = (
        <>
          <polyline
            points={pointsAttr(shape.points)}
            {...common}
            strokeWidth={width}
            strokeOpacity={HIGHLIGHTER_OPACITY}
            strokeLinecap="butt"
          />
          {hitArea && <polyline points={pointsAttr(shape.points)} {...hit(width)} />}
        </>
      );
      break;
    }
    case 'text': {
      const b = shapeBounds(shape);
      body = (
        <>
          <text
            x={shape.x}
            y={shape.y}
            dominantBaseline="hanging"
            fontSize={textFontSize(shape.stroke)}
            fill={shape.color}
            stroke="none"
            fontWeight={600}
          >
            {shape.text}
          </text>
          {hitArea && (
            <rect
              x={b.x}
              y={b.y}
              width={b.w}
              height={b.h}
              fill="transparent"
              stroke="none"
              pointerEvents="all"
            />
          )}
        </>
      );
      break;
    }
  }

  const b = selected ? shapeBounds(shape) : null;
  return (
    <g data-shape-kind={shape.kind}>
      {body}
      {b && (
        <rect
          x={b.x}
          y={b.y}
          width={b.w}
          height={b.h}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={1.5}
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      )}
    </g>
  );
});
