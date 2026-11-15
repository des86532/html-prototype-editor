import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useUiStore } from '@/state/uiStore';
import { ZOOM_MAX, ZOOM_MIN, wheelZoom, zoomStep } from './zoom';

interface Anchor {
  clientX: number;
  clientY: number;
}

/**
 * 整頁縮放的操作：以錨點（滑鼠位置或畫布中心）為中心縮放，並由畫布原生捲動平移。
 * `scale` 是目前實際縮放比例（'fit' 時是 fitScale 的結果）。
 */
export function useViewerZoom(opts: {
  containerEl: HTMLElement | null;
  stageEl: HTMLElement | null;
  scale: number;
}) {
  const { containerEl, stageEl, scale } = opts;
  const scaleRef = useRef(scale);
  const containerRef = useRef(containerEl);
  const stageRef = useRef(stageEl);
  const pending = useRef<({ contentX: number; contentY: number } & Anchor) | null>(null);
  useEffect(() => {
    scaleRef.current = scale;
    containerRef.current = containerEl;
    stageRef.current = stageEl;
  });

  const applyZoom = useCallback((next: 'fit' | number, anchor?: Anchor) => {
    const container = containerRef.current;
    const stage = stageRef.current;
    const ui = useUiStore.getState();
    if (next === 'fit') {
      pending.current = null;
      ui.setZoom('fit');
      // 符合畫面時整頁都放得進畫布，不需要任何捲動位置。
      if (container) {
        container.scrollLeft = 0;
        container.scrollTop = 0;
      }
      return;
    }
    const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
    const current = scaleRef.current;
    if (Math.abs(clamped - current) < 1e-6) {
      if (ui.zoom === 'fit') ui.setZoom(clamped);
      return;
    }
    if (container && stage) {
      const cRect = container.getBoundingClientRect();
      const sRect = stage.getBoundingClientRect();
      const clientX = anchor?.clientX ?? cRect.left + container.clientWidth / 2;
      const clientY = anchor?.clientY ?? cRect.top + container.clientHeight / 2;
      pending.current = {
        contentX: (clientX - sRect.left) / current,
        contentY: (clientY - sRect.top) / current,
        clientX,
        clientY,
      };
    }
    ui.setZoom(clamped);
  }, []);

  // 縮放後把錨點下的內容捲回原本的螢幕位置。
  useLayoutEffect(() => {
    const p = pending.current;
    const container = containerRef.current;
    const stage = stageRef.current;
    if (!p || !container || !stage) return;
    pending.current = null;
    const r = stage.getBoundingClientRect();
    container.scrollLeft += r.left + p.contentX * scale - p.clientX;
    container.scrollTop += r.top + p.contentY * scale - p.clientY;
  }, [scale]);

  const wheelAt = useCallback(
    (dyPx: number, clientX: number, clientY: number) =>
      applyZoom(wheelZoom(scaleRef.current, dyPx), { clientX, clientY }),
    [applyZoom],
  );

  // 容器上的 ⌘／Ctrl＋滾輪（畫布空白處）；frame 與標記畫布內的已在別處處理並 preventDefault。
  useEffect(() => {
    if (!containerEl) return;
    const h = (e: WheelEvent) => {
      if (e.defaultPrevented || !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      wheelAt(e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY, e.clientX, e.clientY);
    };
    containerEl.addEventListener('wheel', h, { passive: false });
    return () => containerEl.removeEventListener('wheel', h);
  }, [containerEl, wheelAt]);

  /** agent 的 zoomWheel：x、y 是 frame viewport 座標 */
  const frameWheel = useCallback(
    (m: { dy: number; x: number; y: number }) => {
      const stage = stageRef.current;
      if (!stage) return;
      const r = stage.getBoundingClientRect();
      const s = scaleRef.current;
      wheelAt(m.dy, r.left + m.x * s, r.top + m.y * s);
    },
    [wheelAt],
  );

  /** 先平移畫布；回傳畫布吃不下的剩餘量（CSS px，已除以 scale），給 frame 內部捲動。 */
  const panBy = useCallback((dx: number, dy: number) => {
    const container = containerRef.current;
    if (!container) return { dx, dy };
    const before = { left: container.scrollLeft, top: container.scrollTop };
    container.scrollBy({ left: dx, top: dy, behavior: 'instant' });
    const rx = dx - (container.scrollLeft - before.left);
    const ry = dy - (container.scrollTop - before.top);
    const s = scaleRef.current;
    return Math.abs(rx) > 0.5 || Math.abs(ry) > 0.5 ? { dx: rx / s, dy: ry / s } : null;
  }, []);

  /** 捲動畫布，讓 stage 內的內容座標（CSS px，縮放前）落在畫布中央。 */
  const centerOn = useCallback((x: number, y: number) => {
    const container = containerRef.current;
    const stage = stageRef.current;
    if (!container || !stage) return;
    const c = container.getBoundingClientRect();
    const r = stage.getBoundingClientRect();
    const s = scaleRef.current;
    container.scrollTo({
      left: r.left - c.left + container.scrollLeft + x * s - container.clientWidth / 2,
      top: r.top - c.top + container.scrollTop + y * s - container.clientHeight / 2,
      behavior: 'instant',
    });
  }, []);

  return {
    applyZoom,
    centerOn,
    wheelAt,
    frameWheel,
    panBy,
    zoomIn: useCallback(() => applyZoom(zoomStep(scaleRef.current, 1)), [applyZoom]),
    zoomOut: useCallback(() => applyZoom(zoomStep(scaleRef.current, -1)), [applyZoom]),
    zoomFit: useCallback(() => applyZoom('fit'), [applyZoom]),
  };
}
