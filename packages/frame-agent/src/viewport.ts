import { PROTOCOL_VERSION } from '@hpe/shared';
import type { AgentModule } from './bridge-types.js';

interface ViewportOptions {
  raf?: (cb: () => void) => number;
  cancelRaf?: (id: number) => void;
}

/**
 * 回報捲動與文件尺寸給 parent（`scroll`），並處理 parent 的 `scrollTo`／`scrollBy`。
 * 所有觸發來源都用 rAF 合併，量測值與上次送出完全相同就不送。
 */
export function createViewport(opts: ViewportOptions = {}): AgentModule {
  const raf = opts.raf ?? ((cb) => window.requestAnimationFrame(cb));
  const cancelRaf = opts.cancelRaf ?? ((id) => window.cancelAnimationFrame(id));
  return (bridge) => {
    const de = document.documentElement;
    let pending: number | null = null;
    let last = '';
    let disposed = false;

    const measure = () => {
      pending = null;
      if (disposed) return;
      const x = window.scrollX;
      const y = window.scrollY;
      const docW = de.scrollWidth;
      const docH = de.scrollHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const key = `${x},${y},${docW},${docH},${vw},${vh}`;
      if (key === last) return;
      last = key;
      bridge.send({ v: PROTOCOL_VERSION, type: 'scroll', x, y, docW, docH, vw, vh });
    };
    const schedule = () => {
      if (pending === null && !disposed) pending = raf(measure);
    };

    // 安裝時立即量一次
    measure();

    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    window.addEventListener('load', schedule);
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    ro?.observe(de);
    let bodyObserved = false;
    const observeBody = () => {
      if (!bodyObserved && document.body) {
        bodyObserved = true;
        ro?.observe(document.body);
      }
    };
    observeBody();
    if (!bodyObserved) document.addEventListener('DOMContentLoaded', observeBody, { once: true });

    const unsubscribe = bridge.subscribe((msg) => {
      if (msg.type === 'scrollTo') {
        window.scrollTo({ left: msg.x, top: msg.y, behavior: 'instant' });
        schedule();
      } else if (msg.type === 'scrollBy') {
        window.scrollBy({ left: msg.dx, top: msg.dy, behavior: 'instant' });
      }
    });

    return () => {
      disposed = true;
      unsubscribe();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('load', schedule);
      document.removeEventListener('DOMContentLoaded', observeBody);
      ro?.disconnect();
      if (pending !== null) cancelRaf(pending);
      pending = null;
    };
  };
}

export const installViewport = createViewport();
