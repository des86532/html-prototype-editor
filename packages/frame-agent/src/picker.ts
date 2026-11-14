import { MESSAGE_LIMITS, PROTOCOL_VERSION, type Mode, type Rect } from '@hpe/shared';
import { containerOf, describe, isStableClass } from '@hpe/anchoring';
import type { AgentBridge, AgentModule } from './bridge-types.js';

/** 拖曳超過這個距離（px）就是區域評論。 */
export const DRAG_THRESHOLD_PX = 8;

/**
 * Comment 模式下在 window 以 capture phase 攔截、不讓 prototype 自己的 handler 看到的事件。
 * mousedown／pointerdown 只 stopPropagation、不 preventDefault：否則瀏覽器不會開始選取文字，
 * 文字評論就無從建立（click、dragstart 等會觸發動作的事件仍然 preventDefault）。
 */
const INTERCEPTED = [
  'pointerdown',
  'pointerup',
  'pointermove',
  'pointerover',
  'pointerout',
  'mousedown',
  'mouseup',
  'mousemove',
  'mouseover',
  'mouseout',
  'click',
  'dblclick',
  'auxclick',
  'contextmenu',
  'dragstart',
] as const;
/** 不攔截，只用來取消進行中的拖曳。 */
const CANCELLERS = ['pointercancel', 'keydown', 'blur'] as const;

interface Press {
  x: number;
  y: number;
  target: Element | null;
  viaPointer: boolean;
  dragging: boolean;
}

const elementOf = (n: EventTarget | null): Element | null => {
  let node = n as Node | null;
  while (node && node.nodeType !== 1) node = node.parentNode;
  return node as Element | null;
};

const rectOf = (el: Element): Rect => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
};

/** 點在容器空白處（例如 flex gap）時，改綁 SNAP_PX 內最近的子元素，讓 pin 跟著該子元素重排。 */
export const SNAP_PX = 16;
const MAX_SNAP_CHILDREN = 200;

export function snapTarget(el: Element | null, x: number, y: number): Element | null {
  if (!el || el === document.documentElement) return el;
  const n = el.childElementCount;
  if (n === 0 || n > MAX_SNAP_CHILDREN) return el;
  let best: Element | null = null;
  let bestD = Infinity;
  for (const child of Array.from(el.children)) {
    const r = rectOf(child);
    if (r.w <= 0 || r.h <= 0) continue;
    const d = Math.hypot(
      Math.max(r.x - x, 0, x - (r.x + r.w)),
      Math.max(r.y - y, 0, y - (r.y + r.h)),
    );
    if (d === 0) return child;
    if (d < bestD) {
      best = child;
      bestD = d;
    }
  }
  return best && bestD <= SNAP_PX ? best : el;
}

/** 例如 `button.cta "Start free trial"`，給 parent 畫 hover 框時當標籤。 */
function labelOf(el: Element): string {
  const cls = Array.from(el.classList).find(isStableClass);
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 30);
  const id = el.id && /^[\w-]{1,40}$/.test(el.id) ? `#${el.id}` : cls ? `.${cls}` : '';
  return `${el.localName}${id}${text ? ` "${text}"` : ''}`.slice(0, MESSAGE_LIMITS.maxLabelLength);
}

const viewportInfo = () => ({
  width: window.innerWidth,
  height: window.innerHeight,
  dpr: window.devicePixelRatio || 1,
});

const raf = (cb: () => void): number =>
  typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame(cb)
    : (setTimeout(cb, 16) as unknown as number);
const cancelRaf = (id: number): void =>
  typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(id) : clearTimeout(id);

function commonAncestor(a: Element | null, b: Element | null): Element {
  let n = a;
  while (n && !(b && n.contains(b))) n = n.parentElement;
  return n ?? document.documentElement;
}

/** 從共同祖先往上找，直到它的 bbox 包住整個拖曳區域。 */
function regionAncestor(region: Rect, start: Element | null, end: Element | null): Element {
  let el = commonAncestor(start, end);
  const covers = (r: Rect) =>
    r.x <= region.x + 1 &&
    r.y <= region.y + 1 &&
    r.x + r.w >= region.x + region.w - 1 &&
    r.y + r.h >= region.y + region.h - 1;
  while (el.parentElement && !covers(rectOf(el))) el = el.parentElement;
  return el;
}

export const installPicker: AgentModule = (bridge: AgentBridge) => {
  let attached = false;
  let press: Press | null = null;
  /** 以 Alt 開始的手勢整段放行，直到放開。 */
  let passthrough = false;
  let hoverEl: Element | null = null;
  let hoverShown = false;
  let pending: { rect: Rect | null; label: string } | null = null;
  let frame: number | null = null;

  const sendHover = (rect: Rect | null, label: string) => {
    hoverShown = rect !== null;
    bridge.send({ v: PROTOCOL_VERSION, type: 'hover', rect, label });
  };
  // hover 訊息以 rAF 合併，避免 pointermove 灌爆 parent 的 120 則/秒限制。
  const scheduleHover = (rect: Rect | null, label: string) => {
    pending = { rect, label };
    if (frame !== null) return;
    frame = raf(() => {
      frame = null;
      const p = pending;
      pending = null;
      if (p) sendHover(p.rect, p.label);
    });
  };
  const clearHover = () => {
    hoverEl = null;
    if (frame !== null) cancelRaf(frame);
    frame = null;
    pending = null;
    if (hoverShown) sendHover(null, '');
  };
  const hoverTo = (el: Element | null) => {
    const target = el && el !== document.documentElement ? el : null;
    if (target === hoverEl) return;
    hoverEl = target;
    if (target) scheduleHover(rectOf(target), labelOf(target));
    else scheduleHover(null, '');
  };

  const pick = (build: () => { anchor: ReturnType<typeof describe>['anchor']; rect: Rect }) => {
    try {
      const { anchor, rect } = build();
      bridge.send({ v: PROTOCOL_VERSION, type: 'pick', draft: anchor, rect });
    } catch {
      /* 壞掉的 DOM 不該讓 agent 掛掉；這次點擊就當沒發生 */
    }
  };

  const finish = (e: MouseEvent) => {
    const p = press;
    press = null;
    if (!p) return;
    const pageId = bridge.pageId();
    const selection = window.getSelection?.() ?? null;
    if (
      selection &&
      !selection.isCollapsed &&
      selection.rangeCount > 0 &&
      selection.toString().trim()
    ) {
      const range = selection.getRangeAt(0).cloneRange();
      const element = containerOf(range);
      if (element) {
        pick(() => describe({ element, kind: 'text', pageId, viewport: viewportInfo(), range }));
        clearHover();
        return;
      }
    }
    const end = elementOf(e.target) ?? p.target;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > DRAG_THRESHOLD_PX) {
      const region = rubberBand(p, e);
      const element = regionAncestor(region, p.target, end);
      pick(() => describe({ element, kind: 'region', pageId, viewport: viewportInfo(), region }));
    } else if (end) {
      pick(() =>
        describe({
          element: snapTarget(end, e.clientX, e.clientY)!,
          kind: 'element',
          pageId,
          viewport: viewportInfo(),
          point: { x: e.clientX, y: e.clientY },
        }),
      );
    }
    clearHover();
  };

  const onEvent = (e: Event) => {
    const me = e as MouseEvent;
    const type = e.type;
    const isPress = type === 'pointerdown' || type === 'mousedown';
    const isRelease = type === 'pointerup' || type === 'mouseup';

    if (
      type === 'pointercancel' ||
      (type === 'blur' && e.target === window) ||
      (type === 'keydown' && (e as KeyboardEvent).key === 'Escape')
    ) {
      if (press) {
        press = null;
        clearHover();
      }
      return;
    }
    if (type === 'keydown' || type === 'blur') return;

    if (passthrough) {
      if (isRelease) passthrough = false;
      return;
    }
    if (me.altKey && !press) {
      if (isPress) passthrough = true;
      clearHover();
      return;
    }

    e.stopImmediatePropagation();
    e.stopPropagation();
    if (!isPress) e.preventDefault();

    if (isPress) {
      if (press?.viaPointer && type === 'mousedown') return;
      if (me.button !== 0) return;
      press = {
        x: me.clientX,
        y: me.clientY,
        target: elementOf(e.target),
        viaPointer: type === 'pointerdown',
        dragging: false,
      };
    } else if (isRelease) {
      if (press?.viaPointer && type === 'mouseup') return;
      finish(me);
    } else if (type === 'pointermove' || type === 'mousemove') {
      if (press) {
        if (press.viaPointer && type === 'mousemove') return;
        if (
          !press.dragging &&
          Math.hypot(me.clientX - press.x, me.clientY - press.y) > DRAG_THRESHOLD_PX
        )
          press.dragging = true;
        if (press.dragging) {
          hoverEl = null;
          scheduleHover(rubberBand(press, me), '區域');
        }
      } else hoverTo(snapTarget(elementOf(e.target), me.clientX, me.clientY));
    } else if (type === 'pointerover' || type === 'mouseover') {
      if (!press) hoverTo(snapTarget(elementOf(e.target), me.clientX, me.clientY));
    } else if (type === 'pointerout' || type === 'mouseout') {
      if (!press && me.relatedTarget === null) hoverTo(null);
    }
  };

  const attach = () => {
    if (attached) return;
    attached = true;
    for (const t of INTERCEPTED) window.addEventListener(t, onEvent, true);
    for (const t of CANCELLERS) window.addEventListener(t, onEvent, true);
  };
  const detach = () => {
    if (!attached) return;
    attached = false;
    for (const t of INTERCEPTED) window.removeEventListener(t, onEvent, true);
    for (const t of CANCELLERS) window.removeEventListener(t, onEvent, true);
    press = null;
    passthrough = false;
    clearHover();
  };
  const setMode = (mode: Mode) => (mode === 'comment' ? attach() : detach());

  const unsubscribe = bridge.subscribe((msg) => {
    if (msg.type === 'init' || msg.type === 'setMode') setMode(msg.mode);
    else if (msg.type === 'describeAt') {
      const element =
        document.elementFromPoint?.(msg.point.x, msg.point.y) ?? document.documentElement;
      try {
        const { anchor, rect } = describe({
          element,
          kind: 'element',
          pageId: bridge.pageId(),
          viewport: viewportInfo(),
          point: msg.point,
        });
        bridge.send({
          v: PROTOCOL_VERSION,
          type: 'described',
          requestId: msg.requestId,
          draft: anchor,
          rect,
        });
      } catch {
        /* 沒有回應 = parent 端逾時 */
      }
    }
  });

  return () => {
    unsubscribe();
    detach();
  };
};

function rubberBand(p: Press, e: MouseEvent): Rect {
  return {
    x: Math.min(p.x, e.clientX),
    y: Math.min(p.y, e.clientY),
    w: Math.abs(e.clientX - p.x),
    h: Math.abs(e.clientY - p.y),
  };
}
