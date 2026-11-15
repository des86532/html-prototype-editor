import { PROTOCOL_VERSION } from '@hpe/shared';
import type { AgentModule } from './bridge-types.js';

interface PointerOptions {
  raf?: (cb: () => void) => number;
  cancelRaf?: (id: number) => void;
}

/**
 * 回報滑鼠位置（viewport 座標）給 parent（`pointer`），給多人協作的即時游標用。
 * pointermove 用 rAF 合併，跟上次送出的值相同就不送；離開文件或視窗失焦時送 null。
 */
export function createPointer(opts: PointerOptions = {}): AgentModule {
  const raf = opts.raf ?? ((cb) => window.requestAnimationFrame(cb));
  const cancelRaf = opts.cancelRaf ?? ((id) => window.cancelAnimationFrame(id));
  return (bridge) => {
    let pending: number | null = null;
    let x = 0;
    let y = 0;
    let last = '';

    const emit = (px: number | null, py: number | null) => {
      const key = `${px},${py}`;
      if (key === last) return;
      last = key;
      bridge.send({ v: PROTOCOL_VERSION, type: 'pointer', x: px, y: py });
    };
    const flush = () => {
      pending = null;
      emit(x, y);
    };
    const onMove = (e: PointerEvent) => {
      x = e.clientX;
      y = e.clientY;
      if (pending === null) pending = raf(flush);
    };
    const onLeave = () => {
      if (pending !== null) cancelRaf(pending);
      pending = null;
      emit(null, null);
    };

    document.addEventListener('pointermove', onMove, { passive: true, capture: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    window.addEventListener('blur', onLeave);

    return () => {
      document.removeEventListener('pointermove', onMove, { capture: true });
      document.documentElement.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('blur', onLeave);
      if (pending !== null) cancelRaf(pending);
      pending = null;
    };
  };
}

export const installPointer = createPointer();
