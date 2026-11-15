import { PROTOCOL_VERSION } from '@hpe/shared';
import type { AgentModule } from './bridge-types.js';

interface WheelZoomOptions {
  raf?: (cb: () => void) => number;
  cancelRaf?: (id: number) => void;
}

/**
 * 轉送 ⌘／Ctrl＋滾輪（含觸控板捏合）給 parent（`zoomWheel`），由 parent 縮放整個畫布。
 * 同時 preventDefault 阻止瀏覽器整頁縮放；用 rAF 合併同一個 frame 內的 delta。
 */
export function createWheelZoom(opts: WheelZoomOptions = {}): AgentModule {
  const raf = opts.raf ?? ((cb) => window.requestAnimationFrame(cb));
  const cancelRaf = opts.cancelRaf ?? ((id) => window.cancelAnimationFrame(id));
  return (bridge) => {
    let pending: number | null = null;
    let dy = 0;
    let x = 0;
    let y = 0;

    const flush = () => {
      pending = null;
      const out = dy;
      dy = 0;
      bridge.send({ v: PROTOCOL_VERSION, type: 'zoomWheel', dy: out, x, y });
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      dy += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      x = e.clientX;
      y = e.clientY;
      if (pending === null) pending = raf(flush);
    };

    window.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => {
      window.removeEventListener('wheel', onWheel, { capture: true });
      if (pending !== null) cancelRaf(pending);
      pending = null;
    };
  };
}

export const installWheelZoom = createWheelZoom();
