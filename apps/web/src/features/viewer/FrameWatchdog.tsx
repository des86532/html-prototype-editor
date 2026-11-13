import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FRAME_TIMINGS,
  PROTOCOL_VERSION,
  type FrameToParent,
  type ParentToFrame,
} from '@hpe/shared';

export type WatchdogState =
  /** iframe 尚未 load */
  | 'loading'
  /** 已收到 ready，心跳正常 */
  | 'ready'
  /** load 後 1.5 秒內沒收到 agent 的 ready：frame 被導到外部頁面（V9） */
  | 'left-scope'
  /** 連續 3 次心跳沒回應（V10：無窮迴圈） */
  | 'unresponsive'
  /** 使用者按了「停止 prototype」，viewer 要把 iframe 移除 */
  | 'stopped';

export interface UseFrameWatchdogOptions {
  iframe: HTMLIFrameElement | null;
  send: (msg: ParentToFrame) => boolean;
  /** 測試可注入較短的時間 */
  timings?: Partial<typeof FRAME_TIMINGS>;
}

/**
 * 規格「導覽守衛」「心跳」：
 *  - iframe `load` 後等 ready，逾時就遮罩（遮罩出現前外部頁面可能短暫顯示，已記錄為殘餘風險）
 *  - 每 2 秒 ping，連續 3 次沒收到對應 pong 就提示無回應
 * 把 agent 訊息餵進 `handleMessage`，其餘行為由 `state` 驅動 UI。
 */
export function useFrameWatchdog({ iframe, send, timings }: UseFrameWatchdogOptions) {
  const t = { ...FRAME_TIMINGS, ...timings };
  const [state, setState] = useState<WatchdogState>('loading');
  const stateRef = useRef<WatchdogState>('loading');
  const setBoth = useCallback((s: WatchdogState) => {
    stateRef.current = s;
    setState(s);
  }, []);
  const sendRef = useRef(send);
  sendRef.current = send;

  const seqRef = useRef(0);
  const lastPongRef = useRef(0);
  const missesRef = useRef(0);
  const readyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearReadyTimer = () => {
    if (readyTimer.current) clearTimeout(readyTimer.current);
    readyTimer.current = null;
  };

  // load 事件：每次文件載入（含 frame 自己導航）都重新等 ready。
  useEffect(() => {
    if (!iframe) return;
    const onLoad = () => {
      if (stateRef.current === 'stopped') return;
      setBoth('loading');
      missesRef.current = 0;
      clearReadyTimer();
      readyTimer.current = setTimeout(() => {
        if (stateRef.current === 'loading') setBoth('left-scope');
      }, t.readyTimeoutMs);
    };
    iframe.addEventListener('load', onLoad);
    return () => {
      iframe.removeEventListener('load', onLoad);
      clearReadyTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iframe, t.readyTimeoutMs, setBoth]);

  // 心跳：只有在 ready / unresponsive 時 ping（unresponsive 時繼續 ping，frame 恢復就自動解除）。
  useEffect(() => {
    if (!iframe) return;
    const id = setInterval(() => {
      const s = stateRef.current;
      if (s !== 'ready' && s !== 'unresponsive') return;
      if (seqRef.current > 0 && lastPongRef.current < seqRef.current) {
        missesRef.current += 1;
        if (missesRef.current >= t.heartbeatMissLimit) setBoth('unresponsive');
      }
      seqRef.current += 1;
      sendRef.current({ v: PROTOCOL_VERSION, type: 'ping', seq: seqRef.current });
    }, t.heartbeatIntervalMs);
    return () => clearInterval(id);
  }, [iframe, t.heartbeatIntervalMs, t.heartbeatMissLimit, setBoth]);

  const handleMessage = useCallback(
    (msg: FrameToParent) => {
      if (msg.type === 'ready') {
        clearReadyTimer();
        missesRef.current = 0;
        seqRef.current = 0;
        lastPongRef.current = 0;
        if (stateRef.current !== 'stopped') setBoth('ready');
      } else if (msg.type === 'pong') {
        lastPongRef.current = Math.max(lastPongRef.current, msg.seq);
        if (msg.seq >= seqRef.current) {
          missesRef.current = 0;
          if (stateRef.current === 'unresponsive') setBoth('ready');
        }
      }
    },
    [setBoth],
  );

  const stop = useCallback(() => setBoth('stopped'), [setBoth]);
  /** 重新載入：回到 loading，由呼叫端重設 iframe（換 key 或 src）。 */
  const reset = useCallback(() => {
    clearReadyTimer();
    missesRef.current = 0;
    seqRef.current = 0;
    lastPongRef.current = 0;
    setBoth('loading');
  }, [setBoth]);

  return { state, handleMessage, stop, reset };
}

export interface FrameWatchdogProps {
  state: WatchdogState;
  onStop: () => void;
  onReload: () => void;
}

/** 蓋在 frame 上的遮罩（V9 離開預覽範圍、V10 無回應）。文字一律是靜態字串，不含 frame 提供的內容。 */
export function FrameWatchdog({ state, onStop, onReload }: FrameWatchdogProps) {
  if (state === 'left-scope') {
    return (
      <div
        role="alertdialog"
        aria-label="prototype 已離開預覽範圍"
        data-testid="watchdog-left-scope"
        className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-white/95 text-center"
      >
        <p className="text-base font-medium">prototype 已離開預覽範圍</p>
        <p className="text-sm text-neutral-600">頁面導向了外部網址，為了安全已被遮罩。</p>
        <button
          type="button"
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white"
          onClick={onReload}
        >
          重新載入
        </button>
      </div>
    );
  }
  if (state === 'unresponsive') {
    return (
      <div
        role="alertdialog"
        aria-label="prototype 無回應"
        data-testid="watchdog-unresponsive"
        className="absolute inset-x-0 top-0 z-50 flex items-center justify-between gap-3 bg-amber-100 px-4 py-2 text-sm"
      >
        <span>prototype 無回應（可能有無窮迴圈）</span>
        <button
          type="button"
          className="rounded bg-neutral-900 px-3 py-1 text-white"
          onClick={onStop}
        >
          停止 prototype
        </button>
      </div>
    );
  }
  if (state === 'stopped') {
    return (
      <div
        data-testid="watchdog-stopped"
        className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-neutral-100 text-center"
      >
        <p className="text-sm">prototype 已停止</p>
        <button
          type="button"
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white"
          onClick={onReload}
        >
          重新載入
        </button>
      </div>
    );
  }
  return null;
}
