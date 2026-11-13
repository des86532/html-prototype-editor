import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  FRAME_TIMINGS,
  PROTOCOL_VERSION,
  type FrameToParent,
  type ParentToFrame,
} from '@hpe/shared';
import '../styles.css';
import { FrameWatchdog, useFrameWatchdog } from '../features/viewer/FrameWatchdog';
import { SandboxFrame } from '../features/viewer/SandboxFrame';
import { useFrameBridge, type BridgeWarning } from '../features/viewer/useFrameBridge';

/**
 * Security suite 專用的 harness（M1 門檻）。它用「和真正 Viewer 完全相同的元件」
 * （SandboxFrame + useFrameBridge + useFrameWatchdog + FrameWatchdog）載入 `?src=` 指定的 content URL，
 * 並把所有可觀察的狀態放在 DOM 與 `window.__harness`，讓 Playwright 斷言。
 * 它不是產品功能，正式環境不應該提供這個頁面。
 */

/** 測試斷言用的 canary：任何向量都不應該能改動它們。 */
const CANARY_COOKIE = 'hpe_canary=canary-cookie-value';
const CANARY_STORAGE_KEY = 'hpe_canary';
const CANARY_STORAGE_VALUE = 'canary-localstorage-value';

/** 模擬 parent 端的機密狀態（D5：這些絕對不能出現在送進 frame 的任何訊息裡）。 */
const PARENT_STATE = {
  threads: [
    {
      id: 'thread-1',
      body: 'SECRET-COMMENT-BODY',
      author: 'SECRET-AUTHOR-NAME',
      token: 'SECRET-SHARE-TOKEN',
    },
  ],
};

document.cookie = `${CANARY_COOKIE}; path=/; SameSite=Lax`;
localStorage.setItem(CANARY_STORAGE_KEY, CANARY_STORAGE_VALUE);

interface VectorResult {
  name: string;
  data: unknown;
}

interface HarnessApi {
  /** frame → parent 通過 gate 的訊息數（依 type） */
  counts: Record<string, number>;
  /** 被 gate 丟棄的訊息數（依原因） */
  dropped: Record<string, number>;
  /** 實際顯示的 toast 文字 */
  toasts: string[];
  /** 因節流而沒顯示的 dialog 數 */
  toastsSuppressed: number;
  /** 向量自己回報的結果（不走協定，只是測試通道；來源必須是 iframe 的 contentWindow） */
  vector: VectorResult[];
  /** 主執行緒 setInterval(50ms) 的最大延遲（ms） */
  maxJitterMs: number;
  /** 通過 gate 的 pick（最近一筆）文字內容 */
  lastPick: { css: string; snapshot: string; tag: string } | null;
  send: (msg: ParentToFrame) => boolean;
  resetStats: () => void;
}

declare global {
  interface Window {
    __harness: HarnessApi;
  }
}

const api: HarnessApi = {
  counts: {},
  dropped: {},
  toasts: [],
  toastsSuppressed: 0,
  vector: [],
  maxJitterMs: 0,
  lastPick: null,
  send: () => false,
  resetStats() {
    api.counts = {};
    api.dropped = {};
    api.toasts = [];
    api.toastsSuppressed = 0;
    api.vector = [];
    api.maxJitterMs = 0;
    api.lastPick = null;
  },
};
window.__harness = api;

let lastJitterTick = performance.now();
setInterval(() => {
  const now = performance.now();
  api.maxJitterMs = Math.max(api.maxJitterMs, now - lastJitterTick - 50);
  lastJitterTick = now;
}, 50);

const FRAME_W = 800;
const FRAME_H = 600;
const MAX_TOASTS_SHOWN = 5;

function Harness() {
  const src = new URLSearchParams(location.search).get('src') ?? '';
  const [iframe, setIframe] = useState<HTMLIFrameElement | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [, setTick] = useState(0);
  const handleRef = useRef<(m: FrameToParent) => void>(() => {});
  const sendRef = useRef<(m: ParentToFrame) => boolean>(() => false);
  const lastToastAt = useRef(-Infinity);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  useLayoutEffect(() => {
    iframeRef.current = iframe;
  });

  // 所有 UI 狀態都放在可變的 api 物件裡，用 250ms 的 tick 重新繪製：
  // V13 一秒 10,000 則訊息時，不能每則訊息都 setState。
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, []);

  const onMessage = useCallback((msg: FrameToParent) => {
    api.counts[msg.type] = (api.counts[msg.type] ?? 0) + 1;
    handleRef.current(msg);
    if (msg.type === 'ready') {
      // parent 只送 init 與 trackAnchors（只有 thread id）；comment 內文、作者、token 永遠不送。
      const first = PARENT_STATE.threads[0];
      sendRef.current({ v: PROTOCOL_VERSION, type: 'init', mode: 'interact' });
      if (first)
        sendRef.current({ v: PROTOCOL_VERSION, type: 'trackAnchors', threadIds: [first.id] });
    } else if (msg.type === 'dialog') {
      // 規格：parent 以純文字 toast 顯示；toast 另外節流（V11）。
      const now = Date.now();
      if (now - lastToastAt.current >= FRAME_TIMINGS.dialogToastThrottleMs) {
        lastToastAt.current = now;
        api.toasts.push(`${msg.kind}: ${msg.text}`);
      } else {
        api.toastsSuppressed += 1;
      }
    } else if (msg.type === 'pick') {
      api.lastPick = {
        css: (msg.draft.selectors.css ?? '').slice(0, 1024),
        snapshot: msg.draft.snapshot.text,
        tag: msg.draft.snapshot.tag,
      };
    }
  }, []);

  const onDropped = useCallback((reason: BridgeWarning) => {
    api.dropped[reason] = (api.dropped[reason] ?? 0) + 1;
  }, []);

  const { send } = useFrameBridge({ iframe, onMessage, onDropped });
  const watchdog = useFrameWatchdog({ iframe, send });
  useLayoutEffect(() => {
    sendRef.current = send;
    api.send = send;
    handleRef.current = watchdog.handleMessage;
  });

  // 向量回報通道（測試專用）：只收 iframe contentWindow 送來、帶 `__vector` 標記的訊息。
  useEffect(() => {
    const onRaw = (e: MessageEvent) => {
      if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return;
      const d: unknown = e.data;
      if (typeof d !== 'object' || d === null || (d as { __vector?: unknown }).__vector !== true)
        return;
      const { name, data } = d as { name?: unknown; data?: unknown };
      if (api.vector.length < 500) api.vector.push({ name: String(name), data });
    };
    window.addEventListener('message', onRaw);
    return () => window.removeEventListener('message', onRaw);
  }, []);

  const { state } = watchdog;
  const toasts = api.toasts.slice(-MAX_TOASTS_SHOWN);
  const pick = api.lastPick;

  return (
    <main className="p-4 text-sm">
      <h1 className="text-base font-semibold">HPE security harness</h1>
      <p>
        狀態：<span data-testid="status">{state}</span>
      </p>
      <p>
        通過 gate 的訊息：<span data-testid="counts">{JSON.stringify(api.counts)}</span>
      </p>
      <p>
        被丟棄的訊息：<span data-testid="dropped">{JSON.stringify(api.dropped)}</span>
      </p>
      <p>
        最大主執行緒延遲：<span data-testid="max-jitter">{Math.round(api.maxJitterMs)}</span> ms
      </p>
      <label className="block">
        另一個輸入框（V10：frame 卡死時仍可操作）
        <input data-testid="probe-input" className="ml-2 border px-1" />
      </label>

      <section aria-label="toasts" data-testid="toasts" role="status" className="my-2">
        {toasts.map((t, i) => (
          <div
            key={`${i}-${t}`}
            data-testid="toast"
            className="rounded bg-neutral-800 px-2 py-1 text-white"
          >
            {t}
          </div>
        ))}
      </section>

      <section aria-label="pick" className="my-2">
        <div>
          pick 選擇器（純文字）：<code data-testid="pick-css">{pick?.css ?? ''}</code>
        </div>
        <div>
          pick 快照：
          <code data-testid="pick-snapshot">{pick ? `${pick.tag}: ${pick.snapshot}` : ''}</code>
        </div>
      </section>

      <section aria-label="comments" className="my-2">
        {PARENT_STATE.threads.map((t) => (
          <article key={t.id} data-testid="parent-comment">
            <strong>{t.author}</strong>：{t.body}
          </article>
        ))}
      </section>

      <div
        style={{ position: 'relative', width: FRAME_W, height: FRAME_H }}
        data-testid="frame-host"
      >
        {state !== 'stopped' && src && (
          <SandboxFrame
            key={reloadKey}
            ref={setIframe}
            src={src}
            width={FRAME_W}
            height={FRAME_H}
            scale={1}
          />
        )}
        <FrameWatchdog
          state={state}
          onStop={watchdog.stop}
          onReload={() => {
            watchdog.reset();
            setReloadKey((k) => k + 1);
          }}
        />
      </div>

      <pre data-testid="vector-results" className="mt-2 max-h-40 overflow-auto text-xs">
        {JSON.stringify(api.vector.slice(-20).map((v) => ({ name: v.name })))}
      </pre>
    </main>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(<Harness />);
