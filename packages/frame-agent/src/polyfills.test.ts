import type { FrameToParent } from '@hpe/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCookieJar, createMemoryStorage, installPolyfillsOn } from './polyfills.js';

describe('memory storage', () => {
  it('behaves like Storage, including property access', () => {
    const { storage: s } = createMemoryStorage(() => {});
    s.setItem('a', 1 as unknown as string);
    s.b = 'two';
    expect(s.getItem('a')).toBe('1');
    expect(s.getItem('b')).toBe('two');
    expect(s.getItem('nope')).toBeNull();
    expect(s.length).toBe(2);
    expect(Object.keys(s)).toEqual(['a', 'b']);
    expect(s.key(1)).toBe('b');
    expect('a' in s).toBe(true);
    delete s.a;
    s.removeItem('b');
    expect(s.length).toBe(0);
    s.setItem('c', 'x');
    s.clear();
    expect(s.length).toBe(0);
  });
  it('does not expose internals and survives a key named like an internal', () => {
    const { storage: s } = createMemoryStorage(() => {});
    expect((s as unknown as Record<string, unknown>).dump).toBeUndefined();
    s.setItem('toJSON', 'x');
    expect(s.getItem('toJSON')).toBe('x');
  });
});

describe('cookie jar', () => {
  it('stores name=value, ignores attributes, deletes on expiry', () => {
    const jar = createCookieJar(() => {});
    jar.set('a=1; path=/; SameSite=Lax');
    jar.set('b=2');
    expect(jar.get()).toBe('a=1; b=2');
    jar.set('a=; expires=Thu, 01 Jan 1970 00:00:00 GMT');
    jar.set('b=; max-age=0');
    expect(jar.get()).toBe('');
  });
});

describe('polyfills on a window', () => {
  let sent: FrameToParent[];
  let handle: ReturnType<typeof installPolyfillsOn>;
  let t = 1_000_000;
  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    t = 1_000_000;
    handle = installPolyfillsOn(
      window,
      (m) => sent.push(m),
      () => t,
    );
  });
  afterEach(() => {
    handle.dispose();
    vi.useRealTimers();
  });

  it('replaces localStorage / sessionStorage / document.cookie', () => {
    localStorage.setItem('k', 'v');
    sessionStorage.setItem('s', 'w');
    document.cookie = 'c=1';
    expect(localStorage.getItem('k')).toBe('v');
    expect(sessionStorage.getItem('s')).toBe('w');
    expect(document.cookie).toBe('c=1');
  });

  it('sends one debounced storageSnapshot per burst and applies a seed without echoing', () => {
    localStorage.setItem('a', '1');
    localStorage.setItem('b', '2');
    expect(sent).toHaveLength(0);
    vi.advanceTimersByTime(600);
    expect(sent).toHaveLength(1);
    const snap = sent[0];
    expect(snap?.type).toBe('storageSnapshot');
    expect(JSON.parse((snap as { data: string }).data).l).toEqual({ a: '1', b: '2' });

    sent.length = 0;
    handle.applySeed(JSON.stringify({ l: { seeded: 'yes' }, s: {}, c: { k: 'v' } }));
    vi.advanceTimersByTime(600);
    expect(sent).toHaveLength(0);
    expect(localStorage.getItem('seeded')).toBe('yes');
    expect(document.cookie).toContain('k=v');
    handle.applySeed('not json');
    handle.applySeed('{"l":{"x":1}}');
    expect(localStorage.getItem('x')).toBeNull();
  });

  it('does not send snapshots above the blob limit', () => {
    localStorage.setItem('big', 'x'.repeat(40 * 1024));
    vi.advanceTimersByTime(600);
    expect(sent).toHaveLength(0);
  });

  it('turns dialogs into throttled messages and keeps the return contract', () => {
    expect(confirm('ok?')).toBe(true);
    expect(prompt('name?')).toBeNull();
    expect(sent).toHaveLength(1); // 後兩個在節流視窗內
    for (let i = 0; i < 1000; i++) alert(i);
    expect(sent).toHaveLength(1);
    t += 1001;
    alert({ toString: () => 'obj' });
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ type: 'dialog', kind: 'alert', text: 'obj' });
    t += 1001;
    alert('y'.repeat(10_000));
    expect((sent[2] as { text: string }).text).toHaveLength(500);
    t += 1001;
    alert({
      toString() {
        throw new Error('x');
      },
    });
    expect((sent[3] as { text: string }).text).toBe('');
  });

  it('window.open is a no-op returning null', () => {
    expect(window.open('https://evil.example')).toBeNull();
  });
});
