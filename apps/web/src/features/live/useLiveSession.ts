import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LIVE_CLOSE,
  LIVE_LIMITS,
  LIVE_PROTOCOL_VERSION,
  LiveServerMessageSchema,
  buildPath,
  type LiveClientMessage,
  type Peer,
  type Thread,
} from '@hpe/shared';
import { apiBaseUrl, getGuestToken, getShareToken } from '@/lib/apiClient';

export type LivePeer = Peer & { cursor: { x: number; y: number } | null };

export interface LiveState {
  status: 'connecting' | 'open' | 'reconnecting' | 'closed';
  selfId: string | null;
  peers: ReadonlyMap<string, LivePeer>;
}

export interface UseLiveSessionOptions {
  versionId: string;
  /** 匯出檔與測試可關閉 */
  enabled: boolean;
  /** 身分改變（訪客留名）時要用新的 guestToken 重連 */
  identityKey: string;
  pageId: string | null;
  width: number;
  onThreadUpsert: (t: Thread) => void;
  onThreadDelete: (id: string) => void;
  /** 重連成功後呼叫 */
  onResync: () => void;
}

const WS_OPEN = 1;
const CLOSE_CODES: readonly number[] = Object.values(LIVE_CLOSE);
const EMPTY_PEERS: ReadonlyMap<string, LivePeer> = new Map();

function liveUrl(versionId: string): string {
  const u = new URL(
    `${apiBaseUrl().replace(/\/+$/, '')}${buildPath('liveVersion', { id: versionId })}`,
    window.location.href,
  );
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return u.toString();
}

/** 單一版本的即時連線：名單、游標、標記同步。斷線時指數退避重連。 */
export function useLiveSession(
  opts: UseLiveSessionOptions,
): LiveState & { sendCursor: (p: { x: number; y: number } | null) => void } {
  const { versionId, enabled, identityKey, pageId, width } = opts;
  const [state, setState] = useState<LiveState>({
    status: 'connecting',
    selfId: null,
    peers: EMPTY_PEERS,
  });

  const optsRef = useRef(opts);
  const presenceRef = useRef({ pageId, width });
  useEffect(() => {
    optsRef.current = opts;
    presenceRef.current = { pageId, width };
  });

  const socketRef = useRef<WebSocket | null>(null);
  const sendRaw = useCallback((msg: LiveClientMessage) => {
    const s = socketRef.current;
    if (s && s.readyState === WS_OPEN) s.send(JSON.stringify(msg));
  }, []);

  useEffect(() => {
    if (!enabled) {
      setState({ status: 'closed', selfId: null, peers: EMPTY_PEERS });
      return;
    }
    let disposed = false;
    let attempt = 0;
    let welcomed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let socket: WebSocket | null = null;
    setState({ status: 'connecting', selfId: null, peers: EMPTY_PEERS });

    const connect = () => {
      const ws = new WebSocket(liveUrl(versionId));
      socket = ws;
      socketRef.current = ws;

      ws.addEventListener('open', () => {
        const shareToken = getShareToken();
        const guestToken = shareToken ? getGuestToken(shareToken) : null;
        const hello: LiveClientMessage = {
          v: LIVE_PROTOCOL_VERSION,
          type: 'hello',
          ...(shareToken ? { shareToken } : {}),
          ...(guestToken ? { guestToken } : {}),
        };
        ws.send(JSON.stringify(hello));
      });

      ws.addEventListener('message', (ev: MessageEvent) => {
        if (typeof ev.data !== 'string') return;
        let raw: unknown;
        try {
          raw = JSON.parse(ev.data);
        } catch {
          return;
        }
        const parsed = LiveServerMessageSchema.safeParse(raw);
        if (!parsed.success) return;
        const msg = parsed.data;
        switch (msg.type) {
          case 'welcome': {
            attempt = 0;
            const peers = new Map<string, LivePeer>();
            for (const p of msg.peers) peers.set(p.id, { ...p, cursor: null });
            setState({ status: 'open', selfId: msg.selfId, peers });
            sendRaw({ v: LIVE_PROTOCOL_VERSION, type: 'presence', ...presenceRef.current });
            if (welcomed) optsRef.current.onResync();
            welcomed = true;
            break;
          }
          case 'peerJoin':
            setState((s) => ({
              ...s,
              peers: new Map(s.peers).set(msg.peer.id, { ...msg.peer, cursor: null }),
            }));
            break;
          case 'peerUpdate':
            setState((s) => {
              const p = s.peers.get(msg.id);
              if (!p) return s;
              // 換頁或換寬度後舊游標座標已不適用
              return {
                ...s,
                peers: new Map(s.peers).set(msg.id, {
                  ...p,
                  pageId: msg.pageId,
                  width: msg.width,
                  cursor: null,
                }),
              };
            });
            break;
          case 'peerLeave':
            setState((s) => {
              if (!s.peers.has(msg.id)) return s;
              const peers = new Map(s.peers);
              peers.delete(msg.id);
              return { ...s, peers };
            });
            break;
          case 'cursor':
            setState((s) => {
              const p = s.peers.get(msg.id);
              if (!p) return s;
              const cursor = msg.x === null || msg.y === null ? null : { x: msg.x, y: msg.y };
              return { ...s, peers: new Map(s.peers).set(msg.id, { ...p, cursor }) };
            });
            break;
          case 'threadUpsert':
            optsRef.current.onThreadUpsert(msg.thread);
            break;
          case 'threadDelete':
            optsRef.current.onThreadDelete(msg.threadId);
            break;
        }
      });

      ws.addEventListener('close', (ev: CloseEvent) => {
        if (disposed || socket !== ws) return;
        socketRef.current = null;
        if (CLOSE_CODES.includes(ev.code)) {
          setState({ status: 'closed', selfId: null, peers: EMPTY_PEERS });
          return;
        }
        setState((s) => ({ status: 'reconnecting', selfId: null, peers: s.peers }));
        const delay =
          Math.min(LIVE_LIMITS.reconnectMaxMs, LIVE_LIMITS.reconnectBaseMs * 2 ** attempt) +
          Math.random() * 250;
        attempt += 1;
        retryTimer = setTimeout(() => {
          retryTimer = null;
          if (!disposed) connect();
        }, delay);
      });
    };

    connect();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      socketRef.current = null;
      try {
        socket?.close(1000);
      } catch {
        // 已關閉
      }
    };
  }, [versionId, enabled, identityKey, sendRaw]);

  // 頁面或寬度改變時更新 presence
  useEffect(() => {
    if (state.status === 'open') {
      sendRaw({ v: LIVE_PROTOCOL_VERSION, type: 'presence', pageId, width });
    }
    // welcome 當下已送過一次；這裡只回應 pageId／width 變化
  }, [pageId, width]);

  // 游標節流：每 cursorSendIntervalMs 最多一次，尾端補送最後一個值；null 立即送出
  const cursorRef = useRef<{
    last: number;
    timer: ReturnType<typeof setTimeout> | null;
    pending: { x: number; y: number } | null;
  }>({ last: 0, timer: null, pending: null });

  useEffect(() => {
    const c = cursorRef.current;
    return () => {
      if (c.timer) clearTimeout(c.timer);
      c.timer = null;
      c.pending = null;
    };
  }, [versionId, enabled, identityKey]);

  const sendCursor = useCallback(
    (p: { x: number; y: number } | null) => {
      const c = cursorRef.current;
      const emit = (v: { x: number; y: number } | null) => {
        c.last = Date.now();
        sendRaw({ v: LIVE_PROTOCOL_VERSION, type: 'cursor', x: v?.x ?? null, y: v?.y ?? null });
      };
      if (p === null) {
        if (c.timer) clearTimeout(c.timer);
        c.timer = null;
        c.pending = null;
        emit(null);
        return;
      }
      const wait = LIVE_LIMITS.cursorSendIntervalMs - (Date.now() - c.last);
      if (wait <= 0 && !c.timer) {
        emit(p);
        return;
      }
      c.pending = p;
      c.timer ??= setTimeout(
        () => {
          c.timer = null;
          const next = c.pending;
          c.pending = null;
          if (next) emit(next);
        },
        Math.max(0, wait),
      );
    },
    [sendRaw],
  );

  return { ...state, sendCursor };
}
