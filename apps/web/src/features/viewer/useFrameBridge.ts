import { useCallback, useEffect, useRef } from 'react';
import { ParentToFrameSchema, type FrameToParent, type ParentToFrame } from '@hpe/shared';
import { FrameGate } from './frameGate';

export type BridgeWarning = 'rate-limited' | 'too-large' | 'schema' | 'foreign-source';

export interface UseFrameBridgeOptions {
  /** 目前的 iframe element（用 state 而不是 ref.current，換頁或重新載入時才會重新綁定）。 */
  iframe: HTMLIFrameElement | null;
  onMessage: (msg: FrameToParent) => void;
  /** 被丟棄的訊息（只用於提示與記錄；foreign-source 不提示以免被 spam） */
  onDropped?: (reason: BridgeWarning) => void;
}

/**
 * 訊息橋：frame → parent 的所有訊息都先過 FrameGate（來源、大小、schema、頻率）。
 * parent → frame 的訊息一律經 ParentToFrameSchema 驗證後才送出；schema 不含 comment body／作者／token（D5）。
 * 送出用 targetOrigin '*'：sandbox 沒有 allow-same-origin，frame 是 opaque origin，無法指定 origin；
 * 因為內容不含任何機密，這是可接受的。
 */
export function useFrameBridge({ iframe, onMessage, onDropped }: UseFrameBridgeOptions) {
  const onMessageRef = useRef(onMessage);
  const onDroppedRef = useRef(onDropped);
  onMessageRef.current = onMessage;
  onDroppedRef.current = onDropped;
  const iframeRef = useRef(iframe);
  iframeRef.current = iframe;

  useEffect(() => {
    if (!iframe) return;
    const gate = new FrameGate(() => iframe.contentWindow);
    const handler = (event: MessageEvent) => {
      const verdict = gate.check(event);
      if (verdict.ok) onMessageRef.current(verdict.message);
      else onDroppedRef.current?.(verdict.reason);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [iframe]);

  const send = useCallback((msg: ParentToFrame) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return false;
    const parsed = ParentToFrameSchema.safeParse(msg);
    if (!parsed.success) {
      throw new Error(`invalid ParentToFrame message: ${msg.type}`);
    }
    win.postMessage(parsed.data, '*');
    return true;
  }, []);

  return { send };
}
