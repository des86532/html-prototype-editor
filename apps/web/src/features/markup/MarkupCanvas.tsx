import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MARKUP_LIMITS,
  authorColor,
  shapeBounds,
  textBox,
  textFontSize,
  type MarkupColor,
  type MarkupShape,
  type MarkupStroke,
  type MarkupTool,
  type Thread,
} from '@hpe/shared';
import { firstLines, truncate } from '@/lib/format';
import type { ViewerMode } from '@/state/uiStore';
import { ShapeSvg } from './ShapeSvg';
import {
  MIN_ARROW_PX,
  MIN_RECT_PX,
  appendPoint,
  badgePoint,
  round1,
  translateShape,
} from './shapes';

export interface MarkupCanvasProps {
  /** 已依頁面、寬度、顯示設定過濾好的 */
  threads: readonly Thread[];
  scroll: { x: number; y: number };
  /** 裝置寬高（ui.device） */
  frameSize: { w: number; h: number };
  scale: number;
  mode: ViewerMode;
  tool: MarkupTool | 'select';
  color: MarkupColor;
  stroke: MarkupStroke;
  selectedId: string | null;
  canManage: (t: Thread) => boolean;
  onSelect: (id: string | null) => void;
  onCreate: (shape: MarkupShape) => void;
  onMove: (t: Thread, shape: MarkupShape) => void;
  onScrollBy: (dx: number, dy: number) => void;
  /** 給 ThreadPopover 的 reference：目前選取標記的 badge 或外框元素 */
  onSelectedAnchor: (el: HTMLElement | null) => void;
  /** 外層元素（popover 的 ignoreOutside） */
  onRootEl?: (el: HTMLElement | null) => void;
}

type Pt = { x: number; y: number };

type Gesture =
  | { kind: 'rect' | 'arrow'; start: Pt }
  | { kind: 'pen' | 'highlighter'; points: [number, number][] }
  | { kind: 'text'; at: Pt }
  | { kind: 'drag'; thread: Thread; start: Pt; moved: boolean };

const DRAG_THRESHOLD_PX = 2;

function previewShape(
  g: Gesture,
  cur: Pt,
  style: { color: MarkupColor; stroke: MarkupStroke },
): MarkupShape | null {
  switch (g.kind) {
    case 'rect':
      return {
        kind: 'rect',
        x: Math.min(g.start.x, cur.x),
        y: Math.min(g.start.y, cur.y),
        w: Math.abs(cur.x - g.start.x),
        h: Math.abs(cur.y - g.start.y),
        ...style,
      };
    case 'arrow':
      return { kind: 'arrow', from: g.start, to: cur, ...style };
    case 'pen':
    case 'highlighter':
      return { kind: g.kind, points: g.points.slice(), ...style };
    default:
      return null;
  }
}

/** 疊在 iframe 上的 overlay：顯示、選取與繪製標記。SVG 以頁面座標繪製，捲動時只改 viewBox。 */
export function MarkupCanvas({
  threads,
  scroll,
  frameSize,
  scale,
  mode,
  tool,
  color,
  stroke,
  selectedId,
  canManage,
  onSelect,
  onCreate,
  onMove,
  onScrollBy,
  onSelectedAnchor,
  onRootEl,
}: MarkupCanvasProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const [preview, setPreview] = useState<MarkupShape | null>(null);
  const [drag, setDrag] = useState<{ id: string; shape: MarkupShape } | null>(null);
  const [textAt, setTextAt] = useState<Pt | null>(null);

  const setRoot = useCallback(
    (el: HTMLDivElement | null) => {
      rootRef.current = el;
      onRootEl?.(el);
    },
    [onRootEl],
  );

  const scrollByRef = useRef(onScrollBy);
  useEffect(() => {
    scrollByRef.current = onScrollBy;
  });
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const h = (e: WheelEvent) => {
      e.preventDefault();
      const k = e.deltaMode === 1 ? 16 : 1;
      scrollByRef.current(e.deltaX * k, e.deltaY * k);
    };
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, []);

  // 離開標記模式或換工具時放棄進行中的手勢與文字輸入
  const gestureKey = `${mode}:${tool}`;
  const [seenKey, setSeenKey] = useState(gestureKey);
  if (seenKey !== gestureKey) {
    setSeenKey(gestureKey);
    setPreview(null);
    setDrag(null);
    setTextAt(null);
  }
  useEffect(() => {
    gesture.current = null;
  }, [gestureKey]);

  const markup = mode === 'markup';
  const w = frameSize.w;
  const h = frameSize.h;
  const style = { color, stroke };

  const toDoc = (e: { clientX: number; clientY: number }): Pt => {
    const r = rootRef.current!.getBoundingClientRect();
    return {
      x: scroll.x + (e.clientX - r.left) / scale,
      y: scroll.y + (e.clientY - r.top) / scale,
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!markup || e.button !== 0) return;
    const target = e.target as Element;
    if (target.closest('[data-markup-id], input')) return;
    const p = toDoc(e);
    if (tool === 'select') {
      const id = target.closest('[data-thread-id]')?.getAttribute('data-thread-id') ?? null;
      onSelect(id);
      const thread = id ? threads.find((t) => t.id === id) : undefined;
      if (thread && canManage(thread)) {
        gesture.current = { kind: 'drag', thread, start: p, moved: false };
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }
      return;
    }
    setTextAt(null);
    if (tool === 'rect' || tool === 'arrow') gesture.current = { kind: tool, start: p };
    else if (tool === 'pen' || tool === 'highlighter')
      gesture.current = { kind: tool, points: [[p.x, p.y]] };
    else gesture.current = { kind: 'text', at: p };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const p = toDoc(e);
    if (g.kind === 'drag') {
      const dx = p.x - g.start.x;
      const dy = p.y - g.start.y;
      if (!g.moved && Math.hypot(dx, dy) <= DRAG_THRESHOLD_PX) return;
      g.moved = true;
      setDrag({ id: g.thread.id, shape: translateShape(g.thread.markup.shape, dx, dy) });
    } else if (g.kind === 'pen' || g.kind === 'highlighter') {
      if (appendPoint(g.points, p.x, p.y)) setPreview(previewShape(g, p, style));
    } else if (g.kind !== 'text') {
      setPreview(previewShape(g, p, style));
    }
  };

  const finish = (e: React.PointerEvent) => {
    const g = gesture.current;
    gesture.current = null;
    setPreview(null);
    setDrag(null);
    if (!g) return;
    const p = toDoc(e);
    switch (g.kind) {
      case 'rect': {
        const x = Math.min(g.start.x, p.x);
        const y = Math.min(g.start.y, p.y);
        const rw = Math.abs(p.x - g.start.x);
        const rh = Math.abs(p.y - g.start.y);
        if (rw < MIN_RECT_PX || rh < MIN_RECT_PX) return;
        onCreate({
          kind: 'rect',
          x: round1(x),
          y: round1(y),
          w: round1(rw),
          h: round1(rh),
          ...style,
        });
        return;
      }
      case 'arrow':
        if (Math.hypot(p.x - g.start.x, p.y - g.start.y) < MIN_ARROW_PX) return;
        onCreate({
          kind: 'arrow',
          from: { x: round1(g.start.x), y: round1(g.start.y) },
          to: { x: round1(p.x), y: round1(p.y) },
          ...style,
        });
        return;
      case 'pen':
      case 'highlighter':
        appendPoint(g.points, p.x, p.y);
        if (g.points.length < 2) return;
        onCreate({
          kind: g.kind,
          points: g.points.map(([x, y]) => [round1(x), round1(y)] as [number, number]),
          ...style,
        });
        return;
      case 'text':
        setTextAt(g.at);
        return;
      case 'drag': {
        const dx = p.x - g.start.x;
        const dy = p.y - g.start.y;
        if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
          onMove(g.thread, translateShape(g.thread.markup.shape, dx, dy));
        }
      }
    }
  };

  const cancel = () => {
    gesture.current = null;
    setPreview(null);
    setDrag(null);
  };

  const commitText = (at: Pt, raw: string) => {
    setTextAt(null);
    const text = raw.trim();
    if (!text) return;
    onCreate({ kind: 'text', x: round1(at.x), y: round1(at.y), text, ...style });
  };

  const hitArea = markup && tool === 'select';
  const numbered = threads.filter((t) => t.number !== null);
  const selected = threads.find((t) => t.id === selectedId);
  const selectedHasBadge = selected !== undefined && selected.number !== null;

  return (
    <div
      ref={setRoot}
      data-testid="markup-canvas"
      className="absolute left-0 top-0 overflow-hidden"
      style={{
        width: w * scale,
        height: h * scale,
        pointerEvents: markup ? 'auto' : 'none',
        touchAction: markup ? 'none' : undefined,
        cursor: markup ? (tool === 'select' ? 'default' : 'crosshair') : undefined,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={cancel}
    >
      <svg
        data-testid="markup-svg"
        width={w * scale}
        height={h * scale}
        viewBox={`${scroll.x} ${scroll.y} ${w} ${h}`}
        className="absolute inset-0"
        style={{ pointerEvents: markup ? 'auto' : 'none' }}
      >
        {threads.map((t) => (
          <g key={t.id} data-thread-id={t.id}>
            <ShapeSvg
              shape={drag?.id === t.id ? drag.shape : t.markup.shape}
              selected={t.id === selectedId}
              hitArea={hitArea}
            />
          </g>
        ))}
        <g data-testid="markup-preview" pointerEvents="none">
          {preview && <ShapeSvg shape={preview} selected={false} hitArea={false} />}
        </g>
      </svg>
      <div
        className="pointer-events-none absolute left-0 top-0"
        style={{ transform: `translate(${-scroll.x * scale}px, ${-scroll.y * scale}px)` }}
      >
        {numbered.map((t) => {
          const shape = drag?.id === t.id ? drag.shape : t.markup.shape;
          const b = badgePoint(shape);
          const first = t.comments[0];
          const n = t.number;
          return (
            <button
              key={t.id}
              type="button"
              data-markup-id={t.id}
              ref={t.id === selectedId ? onSelectedAnchor : undefined}
              aria-label={
                first ? `標記 #${n}：${truncate(firstLines(first.body, 1), 60)}` : `標記 #${n}`
              }
              onClick={() => onSelect(t.id)}
              className={`pointer-events-auto absolute flex size-[22px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full font-mono text-[11px] font-semibold text-white shadow ring-2 ring-surface ${
                t.status === 'resolved' ? 'opacity-50' : ''
              }`}
              style={{ left: b.x * scale, top: b.y * scale, background: authorColor(t.createdBy) }}
            >
              {n}
            </button>
          );
        })}
        {selected && !selectedHasBadge && (
          <div
            data-markup-anchor
            ref={onSelectedAnchor}
            className="pointer-events-none invisible absolute"
            style={(() => {
              const b = shapeBounds(selected.markup.shape);
              return {
                left: b.x * scale,
                top: b.y * scale,
                width: b.w * scale,
                height: b.h * scale,
              };
            })()}
          />
        )}
      </div>
      {markup && textAt && (
        <TextEntry
          key={`${textAt.x},${textAt.y}`}
          left={(textAt.x - scroll.x) * scale}
          top={(textAt.y - scroll.y) * scale}
          fontSize={textFontSize(stroke) * scale}
          color={color}
          scale={scale}
          onCommit={(v) => commitText(textAt, v)}
          onCancel={() => setTextAt(null)}
        />
      )}
    </div>
  );
}

function TextEntry({
  left,
  top,
  fontSize,
  color,
  scale,
  onCommit,
  onCancel,
}: {
  left: number;
  top: number;
  fontSize: number;
  color: string;
  scale: number;
  onCommit: (v: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState('');
  const done = useRef(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const finish = (fn: () => void) => {
    if (done.current) return;
    done.current = true;
    fn();
  };
  const width = Math.max(120, textBox(value, fontSize / scale).w * scale + 16);
  return (
    <input
      ref={ref}
      aria-label="標記文字"
      maxLength={MARKUP_LIMITS.maxTextLength}
      value={value}
      autoFocus
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(() => onCommit(value));
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          finish(onCancel);
        }
      }}
      onBlur={() => finish(() => onCommit(value))}
      className="absolute border border-dashed border-accent bg-transparent p-0 font-semibold outline-none"
      style={{ left, top, width, fontSize, color, lineHeight: 1.3 }}
    />
  );
}
