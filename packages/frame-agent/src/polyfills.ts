import { FRAME_TIMINGS, MESSAGE_LIMITS, PROTOCOL_VERSION, type FrameToParent } from '@hpe/shared';
import type { AgentModule } from './bridge-types.js';
import { createLeadingThrottle, safeText } from './throttle.js';

/** 規格「frame-agent 的相容與防護層」：Storage／Dialog polyfill。agent 不是安全邊界，只負責相容性。 */

const SNAPSHOT_DEBOUNCE_MS = 500;

type StringMap = Record<string, string>;

/** 以記憶體實作的 Storage（支援 `storage.foo = 'x'` 屬性存取與 Object.keys）。load／dump 不掛在 storage 上。 */
export function createMemoryStorage(onChange: () => void) {
  const data = new Map<string, string>();
  const api = {
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][Number(i)] ?? null,
    getItem: (k: unknown) => data.get(String(k)) ?? null,
    setItem(k: unknown, v: unknown) {
      data.set(String(k), String(v));
      onChange();
    },
    removeItem(k: unknown) {
      if (data.delete(String(k))) onChange();
    },
    clear() {
      if (data.size === 0) return;
      data.clear();
      onChange();
    },
  };
  const isApi = (p: string | symbol): p is keyof typeof api =>
    typeof p === 'string' && Object.prototype.hasOwnProperty.call(api, p);
  const storage = new Proxy(api, {
    get(t, p) {
      if (p === Symbol.toStringTag) return 'Storage';
      if (typeof p === 'symbol') return undefined;
      if (isApi(p)) return t[p];
      return data.get(p);
    },
    set(_t, p, v) {
      if (typeof p === 'symbol') return false;
      data.set(p, String(v));
      onChange();
      return true;
    },
    has: (_t, p) => isApi(p) || (typeof p === 'string' && data.has(p)),
    deleteProperty(_t, p) {
      if (typeof p === 'string' && data.delete(p)) onChange();
      return true;
    },
    ownKeys: () => [...data.keys()],
    getOwnPropertyDescriptor: (_t, p) =>
      typeof p === 'string' && data.has(p)
        ? { value: data.get(p), writable: true, enumerable: true, configurable: true }
        : undefined,
  }) as unknown as Storage;
  return {
    storage,
    load(d: StringMap) {
      for (const [k, v] of Object.entries(d)) data.set(k, v);
    },
    dump: (): StringMap => Object.fromEntries(data),
  };
}

/** 以記憶體實作的 document.cookie（只保留 name=value，屬性中只看 expires／max-age 判斷刪除）。 */
export function createCookieJar(onChange: () => void) {
  const jar = new Map<string, string>();
  return {
    get: () => [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
    set(raw: unknown) {
      const parts = String(raw).split(';');
      const pair = (parts.shift() ?? '').trim();
      const eq = pair.indexOf('=');
      const name = (eq < 0 ? '' : pair.slice(0, eq)).trim();
      const value = eq < 0 ? pair : pair.slice(eq + 1);
      let expired = false;
      for (const attr of parts) {
        const [k = '', ...rest] = attr.split('=');
        const key = k.trim().toLowerCase();
        const val = rest.join('=').trim();
        if (key === 'max-age' && Number(val) <= 0) expired = true;
        if (key === 'expires' && Date.parse(val) <= Date.now()) expired = true;
      }
      if (expired) {
        if (jar.delete(name)) onChange();
      } else {
        jar.set(name, value);
        onChange();
      }
    },
    load(d: StringMap) {
      for (const [k, v] of Object.entries(d)) jar.set(k, v);
    },
    dump: () => Object.fromEntries(jar),
  };
}

function isStringMap(v: unknown): v is StringMap {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    Object.values(v).every((x) => typeof x === 'string')
  );
}

function define(target: object, prop: string, descriptor: PropertyDescriptor): void {
  try {
    Object.defineProperty(target, prop, { configurable: true, enumerable: true, ...descriptor });
  } catch {
    /* 無法覆寫就維持原狀（相容性功能，非安全邊界） */
  }
}

export function installPolyfillsOn(
  win: Window,
  send: (msg: FrameToParent) => void,
  now: () => number = () => Date.now(),
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let applyingSeed = false;
  const bytes = (s: string) => new TextEncoder().encode(s).length;

  const local = createMemoryStorage(() => changed());
  const session = createMemoryStorage(() => changed());
  const cookies = createCookieJar(() => changed());

  function snapshot(): string {
    return JSON.stringify({ l: local.dump(), s: session.dump(), c: cookies.dump() });
  }
  function flush() {
    timer = undefined;
    const data = snapshot();
    // 超過上限就不送（parent 也會擋），避免 prototype 把大量資料塞進 parent 記憶體。
    if (bytes(data) > MESSAGE_LIMITS.maxStorageBlobBytes) return;
    send({ v: PROTOCOL_VERSION, type: 'storageSnapshot', data });
  }
  function changed() {
    if (applyingSeed || timer !== undefined) return;
    timer = setTimeout(flush, SNAPSHOT_DEBOUNCE_MS);
  }

  define(win, 'localStorage', { get: () => local.storage });
  define(win, 'sessionStorage', { get: () => session.storage });
  define(win.document, 'cookie', {
    get: () => cookies.get(),
    set: (v: unknown) => cookies.set(v),
  });

  // Dialog：alert/confirm/prompt 改成訊息給 parent（純文字 toast）；window.open 無效。
  const allow = createLeadingThrottle(FRAME_TIMINGS.dialogToastThrottleMs, now);
  const dialog = (kind: 'alert' | 'confirm' | 'prompt', message: unknown) => {
    if (!allow()) return;
    send({
      v: PROTOCOL_VERSION,
      type: 'dialog',
      kind,
      text: safeText(message, MESSAGE_LIMITS.maxDialogTextLength),
    });
  };
  define(win, 'alert', {
    value: (m?: unknown) => {
      dialog('alert', m);
    },
    writable: true,
  });
  define(win, 'confirm', {
    value: (m?: unknown) => {
      dialog('confirm', m);
      return true;
    },
    writable: true,
  });
  define(win, 'prompt', {
    value: (m?: unknown) => {
      dialog('prompt', m);
      return null;
    },
    writable: true,
  });
  define(win, 'open', { value: () => null, writable: true });

  const onHide = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      flush();
    }
  };
  win.addEventListener('pagehide', onHide);

  return {
    /** `init.storageSeed`：opaque blob，只解析我們自己產生的格式；格式不符就忽略。 */
    applySeed(seed: string) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(seed);
      } catch {
        return;
      }
      if (typeof parsed !== 'object' || parsed === null) return;
      const p = parsed as Record<string, unknown>;
      applyingSeed = true;
      try {
        if (isStringMap(p.l)) local.load(p.l);
        if (isStringMap(p.s)) session.load(p.s);
        if (isStringMap(p.c)) cookies.load(p.c);
      } finally {
        applyingSeed = false;
      }
    },
    dispose() {
      if (timer !== undefined) clearTimeout(timer);
      win.removeEventListener('pagehide', onHide);
    },
  };
}

export const installPolyfills: AgentModule = (bridge) => {
  const handle = installPolyfillsOn(window, (m) => bridge.send(m));
  const off = bridge.subscribe((msg) => {
    if (msg.type === 'init' && msg.storageSeed) handle.applySeed(msg.storageSeed);
  });
  return () => {
    off();
    handle.dispose();
  };
};
