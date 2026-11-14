import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FrameToParent, ParentToFrame } from '@hpe/shared';
import { FrameGate } from './frameGate';
import { useFrameWatchdog } from './FrameWatchdog';

afterEach(cleanup);

const source = {};
const pong = (seq: number): FrameToParent => ({ v: 1, type: 'pong', seq });

describe('FrameGate', () => {
  it('drops messages from other windows even when the payload is valid', () => {
    const gate = new FrameGate(() => source);
    expect(gate.check({ source: {}, data: pong(1) })).toEqual({
      ok: false,
      reason: 'foreign-source',
    });
    expect(gate.check({ source: null, data: pong(1) })).toEqual({
      ok: false,
      reason: 'foreign-source',
    });
    expect(gate.check({ source, data: pong(1) }).ok).toBe(true);
  });

  it('drops oversize and malformed payloads', () => {
    const gate = new FrameGate(() => source);
    const big = { v: 1, type: 'dialog', kind: 'alert', text: 'x'.repeat(1_000_000) };
    expect(gate.check({ source, data: big })).toEqual({ ok: false, reason: 'too-large' });
    expect(gate.check({ source, data: { v: 1, type: 'nope' } })).toEqual({
      ok: false,
      reason: 'schema',
    });
    expect(gate.check({ source, data: 'string' })).toEqual({ ok: false, reason: 'schema' });
  });

  it('rate limits bursts to 120/s and recovers after the cooldown', () => {
    let now = 0;
    const gate = new FrameGate(
      () => source,
      () => now,
    );
    let accepted = 0;
    for (let i = 0; i < 10_000; i++) if (gate.check({ source, data: pong(i) }).ok) accepted++;
    expect(accepted).toBe(120);
    expect(gate.check({ source, data: pong(1) })).toEqual({ ok: false, reason: 'rate-limited' });
    now += 1500;
    expect(gate.check({ source, data: pong(1) }).ok).toBe(true);
  });
});

describe('useFrameWatchdog', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = () => {
    const iframe = document.createElement('iframe');
    const sent: ParentToFrame[] = [];
    const hook = renderHook(() =>
      useFrameWatchdog({
        iframe,
        send: (m) => {
          sent.push(m);
          return true;
        },
      }),
    );
    return { iframe, sent, hook };
  };
  const ready: FrameToParent = {
    v: 1,
    type: 'ready',
    agentVersion: '1',
    pageId: 'index.html',
    hash: '',
    docSize: { w: 1, h: 1 },
  };

  it('masks the frame when no ready arrives within 1.5s of load (frame navigated away)', () => {
    const { iframe, hook } = setup();
    act(() => void iframe.dispatchEvent(new Event('load')));
    act(() => void vi.advanceTimersByTime(1400));
    expect(hook.result.current.state).toBe('loading');
    act(() => void vi.advanceTimersByTime(200));
    expect(hook.result.current.state).toBe('left-scope');
  });

  it('stays ready when ready arrives in time and pongs keep coming', () => {
    const { iframe, sent, hook } = setup();
    act(() => void iframe.dispatchEvent(new Event('load')));
    act(() => hook.result.current.handleMessage(ready));
    for (let i = 0; i < 6; i++) {
      act(() => void vi.advanceTimersByTime(2000));
      const last = sent[sent.length - 1];
      if (last?.type === 'ping') act(() => hook.result.current.handleMessage(pong(last.seq)));
    }
    expect(hook.result.current.state).toBe('ready');
  });

  it('flags unresponsive after 3 unanswered pings and recovers on a pong', () => {
    const { iframe, sent, hook } = setup();
    act(() => void iframe.dispatchEvent(new Event('load')));
    act(() => hook.result.current.handleMessage(ready));
    act(() => void vi.advanceTimersByTime(2000 * 5));
    expect(hook.result.current.state).toBe('unresponsive');
    const last = sent[sent.length - 1];
    if (last?.type !== 'ping') throw new Error('expected a ping');
    act(() => hook.result.current.handleMessage(pong(last.seq)));
    expect(hook.result.current.state).toBe('ready');
  });

  it('stop() is terminal until reset', () => {
    const { iframe, hook } = setup();
    act(() => void iframe.dispatchEvent(new Event('load')));
    act(() => hook.result.current.stop());
    act(() => hook.result.current.handleMessage(ready));
    expect(hook.result.current.state).toBe('stopped');
  });
});
