import type { FrameToParent } from '@hpe/shared';
import { describe, expect, it, vi } from 'vitest';
import { createBridge } from './bridge.js';
import { installHeartbeat } from './heartbeat.js';

function setup() {
  const listeners: ((e: MessageEvent) => void)[] = [];
  const posted: { data: unknown; target: string }[] = [];
  const parent = { postMessage: (data: unknown, target: string) => posted.push({ data, target }) };
  const doc = document.implementation.createHTMLDocument('');
  const s = doc.createElement('script');
  s.setAttribute('data-hpe-page', 'pricing/plans.html');
  doc.head.append(s);
  const win = {
    document: doc,
    location: { pathname: '/x.html' },
    parent,
    addEventListener: (_: string, l: (e: MessageEvent) => void) => listeners.push(l),
  } as unknown as Window;
  const deliver = (data: unknown, source: unknown = parent) =>
    listeners.forEach((l) => l({ data, source } as MessageEvent));
  return { bridge: createBridge(win), posted, deliver, parent };
}

describe('bridge', () => {
  it('reads pageId from data-hpe-page', () => {
    expect(setup().bridge.pageId()).toBe('pricing/plans.html');
  });
  it('only accepts validated messages from window.parent', () => {
    const { bridge, deliver } = setup();
    const got = vi.fn();
    bridge.subscribe(got);
    deliver({ v: 1, type: 'ping', seq: 1 }, {});
    deliver({ v: 1, type: 'ping', seq: 'x' });
    deliver({ v: 1, type: 'ping', seq: 2 });
    expect(got).toHaveBeenCalledTimes(1);
    expect(got).toHaveBeenCalledWith({ v: 1, type: 'ping', seq: 2 });
  });
  it('posts to the parent with targetOrigin *', () => {
    const { bridge, posted } = setup();
    const msg: FrameToParent = { v: 1, type: 'pong', seq: 1 };
    bridge.send(msg);
    expect(posted).toEqual([{ data: msg, target: '*' }]);
  });
  it('a throwing subscriber does not break the others; unsubscribe works', () => {
    const { bridge, deliver } = setup();
    const ok = vi.fn();
    bridge.subscribe(() => {
      throw new Error('boom');
    });
    const off = bridge.subscribe(ok);
    deliver({ v: 1, type: 'ping', seq: 1 });
    off();
    deliver({ v: 1, type: 'ping', seq: 2 });
    expect(ok).toHaveBeenCalledTimes(1);
  });
  it('heartbeat answers ping with pong of the same seq', () => {
    const { bridge, deliver, posted } = setup();
    installHeartbeat(bridge);
    deliver({ v: 1, type: 'ping', seq: 7 });
    expect(posted.map((p) => p.data)).toEqual([{ v: 1, type: 'pong', seq: 7 }]);
  });
});
