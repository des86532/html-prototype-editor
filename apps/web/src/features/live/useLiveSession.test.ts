import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIVE_CLOSE, LIVE_PROTOCOL_VERSION } from '@hpe/shared';
import { setShareToken } from '@/lib/apiClient';
import { useLiveSession } from './useLiveSession';

class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  closeCode: number | null = null;
  private listeners = new Map<string, ((ev: unknown) => void)[]>();
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  addEventListener(type: string, fn: (ev: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(code?: number) {
    this.closeCode = code ?? 1000;
    this.readyState = 3;
  }
  private emit(type: string, ev: unknown) {
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }
  open() {
    this.readyState = 1;
    this.emit('open', {});
  }
  receive(msg: unknown) {
    this.emit('message', { data: JSON.stringify(msg) });
  }
  drop(code: number) {
    this.readyState = 3;
    this.emit('close', { code });
  }
}

const welcome = (selfId = 'me') => ({
  v: LIVE_PROTOCOL_VERSION,
  type: 'welcome',
  selfId,
  peers: [],
});

function setup(over: Partial<Parameters<typeof useLiveSession>[0]> = {}) {
  const cbs = { onThreadUpsert: vi.fn(), onThreadDelete: vi.fn(), onResync: vi.fn() };
  const hook = renderHook(() =>
    useLiveSession({
      versionId: 'v1',
      enabled: true,
      identityKey: 'anon',
      pageId: 'index.html',
      width: 1440,
      ...cbs,
      ...over,
    }),
  );
  return { ...hook, cbs };
}

const last = () => FakeSocket.instances.at(-1)!;

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.spyOn(Math, 'random').mockReturnValue(0);
  setShareToken('share-tok');
});
afterEach(() => {
  setShareToken(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useLiveSession', () => {
  it('connects over ws and sends hello with the share token first', () => {
    setup();
    expect(FakeSocket.instances).toHaveLength(1);
    expect(last().url).toMatch(/^ws:\/\/.+\/versions\/v1\/live$/);
    act(() => last().open());
    expect(last().sent[0]).toMatchObject({
      v: LIVE_PROTOCOL_VERSION,
      type: 'hello',
      shareToken: 'share-tok',
    });
  });

  it('welcome opens the session and sends presence', () => {
    const { result } = setup();
    act(() => last().open());
    act(() => last().receive(welcome()));
    expect(result.current.status).toBe('open');
    expect(result.current.selfId).toBe('me');
    expect(last().sent[1]).toEqual({
      v: LIVE_PROTOCOL_VERSION,
      type: 'presence',
      pageId: 'index.html',
      width: 1440,
    });
  });

  it('does not reconnect after a LIVE_CLOSE code', () => {
    const { result } = setup();
    act(() => last().open());
    act(() => last().receive(welcome()));
    act(() => last().drop(LIVE_CLOSE.forbidden));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(FakeSocket.instances).toHaveLength(1);
    expect(result.current.status).toBe('closed');
  });

  it('reconnects with backoff after 1006 and resyncs on the second welcome', () => {
    const { result, cbs } = setup();
    act(() => last().open());
    act(() => last().receive(welcome()));
    expect(cbs.onResync).not.toHaveBeenCalled();

    act(() => last().drop(1006));
    expect(result.current.status).toBe('reconnecting');
    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(FakeSocket.instances).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(FakeSocket.instances).toHaveLength(2);

    // 第二次連線沒有 welcome 就又掉線：下一次延遲 2 秒
    act(() => last().drop(1006));
    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(FakeSocket.instances).toHaveLength(2);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(FakeSocket.instances).toHaveLength(3);

    act(() => last().open());
    act(() => last().receive(welcome()));
    expect(cbs.onResync).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('open');
  });

  it('throttles cursor sends: first immediately, trailing value after the interval', () => {
    const { result } = setup();
    act(() => last().open());
    act(() => last().receive(welcome()));
    const before = last().sent.length;
    act(() => {
      for (let i = 1; i <= 5; i++) result.current.sendCursor({ x: i, y: i });
    });
    expect(last().sent.length - before).toBe(1);
    act(() => {
      vi.advanceTimersByTime(60);
    });
    const cursors = last().sent.slice(before);
    expect(cursors).toHaveLength(2);
    expect(cursors[1]).toMatchObject({ type: 'cursor', x: 5, y: 5 });
  });

  it('forwards thread events and tracks peers', () => {
    const { result, cbs } = setup();
    act(() => last().open());
    act(() => last().receive(welcome()));
    act(() => last().receive({ v: LIVE_PROTOCOL_VERSION, type: 'threadDelete', threadId: 't9' }));
    expect(cbs.onThreadDelete).toHaveBeenCalledWith('t9');
    act(() =>
      last().receive({
        v: LIVE_PROTOCOL_VERSION,
        type: 'peerJoin',
        peer: { id: 'p2', name: 'Bob', colorKey: 'b', pageId: null, width: null },
      }),
    );
    act(() => last().receive({ v: LIVE_PROTOCOL_VERSION, type: 'cursor', id: 'p2', x: 10, y: 20 }));
    expect(result.current.peers.get('p2')?.cursor).toEqual({ x: 10, y: 20 });
    // 不合法的訊息被忽略
    act(() => last().receive({ v: 99, type: 'cursor', id: 'p2', x: 1, y: 1 }));
    expect(result.current.peers.get('p2')?.cursor).toEqual({ x: 10, y: 20 });
  });

  it('does not connect when disabled', () => {
    setup({ enabled: false });
    expect(FakeSocket.instances).toHaveLength(0);
  });
});
