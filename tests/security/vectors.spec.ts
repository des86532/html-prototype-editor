import {
  SECRETS,
  EVIL_ORIGIN,
  APP_ORIGIN,
  CONTENT_BASE_DOMAIN,
  TEST_KEY,
  UNKNOWN_KEY,
  VECTORS_DIR,
} from './config.js';
import { contentGet, expect, test } from './fixtures.js';

type Dict = Record<string, unknown>;

/** csp 事件中出現的 directive（去掉 `-elem`／`-attr` 後綴以容忍瀏覽器差異）。 */
const normalize = (d: unknown) => String(d).replace(/-(elem|attr)$/, '');

async function cspDirectives(h: { vectorData: <T>(n: string) => Promise<T[]> }): Promise<string[]> {
  return (await h.vectorData<{ directive: string }>('csp')).map((c) => normalize(c.directive));
}

test.describe('控制組：evil server 的紀錄器可信', () => {
  test('瀏覽器連得到 evil server，且 fetch／beacon／圖片／WebSocket 都會被記錄（否則所有「0 個請求」都是空轉）', async ({
    page,
    servers,
  }) => {
    servers.evil.reset();
    await page.goto(`${EVIL_ORIGIN}/control`);
    await expect(page.locator('h1')).toHaveText('evil');
    await page.evaluate(async () => {
      await fetch('/c-fetch');
      navigator.sendBeacon('/c-beacon', 'x');
      await new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = img.onerror = () => resolve();
        img.src = '/c-image.png';
      });
      await new Promise<void>((resolve) => {
        const ws = new WebSocket('ws://evil.localhost:6100/c-ws');
        ws.onerror = ws.onclose = () => resolve();
      });
    });
    await expect
      .poll(() =>
        servers.evil
          .requests()
          .map((r) => `${r.method} ${r.url}`)
          .filter((r) => !r.endsWith('/favicon.ico'))
          .sort(),
      )
      .toEqual(
        ['GET /c-fetch', 'GET /c-image.png', 'GET /c-ws', 'GET /control', 'POST /c-beacon'].sort(),
      );
  });
});

test.describe('V1 parent.document / top.document 存取', () => {
  test('丟出 SecurityError，父頁面沒被改動', async ({ harness: h }) => {
    await h.open('v01-parent-access.html');
    await h.waitForVector();
    const [r] = await h.vectorData<Dict>('result');
    expect(r).toMatchObject({
      cookieErr: 'SecurityError',
      innerHTMLErr: 'SecurityError',
      parentStorageErr: 'SecurityError',
    });
    expect(r?.cookie).toBeUndefined();
    expect(r?.innerHTML).toBeUndefined();
    expect(r?.parentLocationErr).toBe('SecurityError');
  });
});

test.describe('V2 top.location 導向', () => {
  test('被擋（沒有 allow-top-navigation）', async ({ harness: h }) => {
    await h.open('v02-top-navigation.html');
    await h.waitForVector();
    // 具體行為依瀏覽器而異（丟錯或靜默忽略），共同條件是：沒有任何導航發生、evil 沒收到請求（teardown 會檢查）。
    const [r] = await h.vectorData<Dict>('result');
    expect(Object.keys(r ?? {})).toEqual(
      expect.arrayContaining(['assign', 'href', 'replace', 'parent']),
    );
    expect(h.page.url()).toContain('/harness.html');
  });
});

test.describe('V3 window.open 與 target=_blank', () => {
  test('被擋（沒有 allow-popups），agent 的 window.open 也是 no-op', async ({ harness: h }) => {
    await h.open('v03-popups.html');
    await h.waitForVector();
    const [r] = await h.vectorData<Dict>('result');
    expect(r?.agentOpen).toBe('null');
    // 沒有 agent 的子 frame（原生行為）：沒有 allow-popups → window.open 回 null 或丟 SecurityError，絕不會回傳 window。
    const child = r?.child as Dict;
    expect(['null', 'SecurityError', 'InvalidAccessError']).toContain(child.nativeOpen);
    expect(child.timeout).toBeUndefined();
    await h.page.waitForTimeout(500);
    expect(h.page.context().pages()).toHaveLength(1);
  });
});

test.describe('V4 connect-src', () => {
  test('fetch／XHR／sendBeacon／WebSocket 打向 evil 全部被 CSP 擋下，bundle 內 fetch 正常', async ({
    harness: h,
  }) => {
    await h.open('v04-network.html');
    await h.waitForVector();
    const [r] = await h.vectorData<Dict>('result');
    expect(r?.fetch).toBe('TypeError');
    expect(r?.fetchNoCors).toBe('TypeError');
    expect(r?.xhr).not.toBe('loaded');
    expect(typeof r?.beacon).toBe('boolean'); // sendBeacon 只是「排入佇列」；實際請求被 CSP 擋掉（evil 0 請求由 teardown 檢查）
    expect(r?.ws).not.toBe('open');
    expect(r?.selfFetch).toBe('ok');
    const directives = await cspDirectives(h);
    expect(directives.filter((d) => d === 'connect-src').length).toBeGreaterThanOrEqual(4);
  });
});

test.describe('V5 img-src／font-src／style-src', () => {
  test('Image、CSS url()、@font-face、@import、<link>、<script src>、<video> 全部被擋，bundle 內圖片正常', async ({
    harness: h,
  }) => {
    await h.open('v05-resources.html');
    await h.waitForVector();
    const [r] = await h.vectorData<Dict>('result');
    expect(r?.selfImage).toBe('loaded');
    const directives = new Set(await cspDirectives(h));
    for (const d of ['img-src', 'font-src', 'style-src', 'script-src', 'media-src'])
      expect(directives, d).toContain(d);
  });
});

test.describe('V6 form 送出', () => {
  test('送不出去，submit 事件被攔截並顯示「預覽模式不送出表單」', async ({ harness: h }) => {
    await h.open('v06-form.html');
    await h.waitForVector();
    await expect(h.page.getByTestId('toast').first()).toHaveText('alert: 預覽模式不送出表單');
    // 子 frame（沒有 agent）的原生 submit 被 sandbox／form-action 擋下；evil 沒收到請求由 teardown 檢查。
    const [r] = await h.vectorData<Dict>('result');
    expect((r?.child as Dict).timeout).toBeUndefined();
  });
});

test.describe('V7 <base>', () => {
  test('違反 base-uri，base 沒有生效', async ({ harness: h }) => {
    await h.open('v07-base.html');
    await h.waitForVector();
    const [r] = await h.vectorData<{ baseURI: string; origin: string }>('result');
    expect(r?.baseURI.startsWith(r?.origin ?? '?')).toBe(true);
    expect(await cspDirectives(h)).toContain('base-uri');
  });
});

test.describe('V8 iframe／object／embed', () => {
  test('違反 frame-src／object-src', async ({ harness: h }) => {
    await h.open('v08-embeds.html');
    await h.waitForVector();
    const directives = await cspDirectives(h);
    expect(directives.filter((d) => d === 'frame-src').length).toBeGreaterThanOrEqual(2);
    expect(directives.filter((d) => d === 'object-src').length).toBeGreaterThanOrEqual(2);
  });
});

test.describe('V9 frame 自行導航到外部', () => {
  for (const [name, file] of [
    ['location.href', 'v09-location.html'],
    ['<meta http-equiv=refresh>', 'v09-meta-refresh.html'],
  ] as const) {
    test(`${name}：1.5 秒內遮罩，evil 最多收到 1 次導航請求`, async ({ harness: h }) => {
      h.allowEvilRequests = 1; // 殘餘風險：frame 自己的導航請求（規格）
      await h.open(file, { waitReady: false });
      await h.page.waitForTimeout(4_000);
      const evil = h.evilRequests();
      expect(evil.length).toBeLessThanOrEqual(1);
      const first = evil[0];
      if (first) {
        expect(first.dest).toBe('iframe');
        expect(first.method).toBe('GET');
      }
      const status = await h.status();
      if (status === 'left-scope') {
        // 導航發生（或被擋後出現錯誤頁並觸發 load）→ 遮罩必須出現
        await expect(h.page.getByTestId('watchdog-left-scope')).toContainText(
          'prototype 已離開預覽範圍',
        );
        await expect(h.page.getByRole('button', { name: '重新載入' })).toBeVisible();
      } else {
        // 瀏覽器（Firefox）依主應用的 frame-src 直接擋掉導航：frame 留在原文件、沒有任何請求送出。
        expect(status).toBe('ready');
        expect(evil).toHaveLength(0);
      }
      console.log(
        `[V9 ${name}] status=${status} evil navigation requests observed: ${evil.length}`,
      );
    });
  }

  test('遮罩出現的時間 ≤ 1.5 秒 + slack（以 iframe load 為起點）', async ({ harness: h }) => {
    h.allowEvilRequests = 1;
    await h.page.goto(`${APP_ORIGIN}/harness.html`); // 確保 harness 就緒
    await h.page.evaluate(() => {
      (window as unknown as { __maskAt: number }).__maskAt = 0;
    });
    const src = h.vectorUrl('v09-location.html');
    await h.page.goto(`${APP_ORIGIN}/harness.html?src=${encodeURIComponent(src)}`);
    await expect(h.page.getByTestId('status')).toHaveText('ready', { timeout: 10_000 });
    // 觀察 iframe 的 load 事件與遮罩出現時間
    const timing = await h.page.evaluate(
      () =>
        new Promise<{ maskDelay: number }>((resolve) => {
          setTimeout(() => resolve({ maskDelay: -1 }), 5000); // 沒有 load 事件（導航被 frame-src 直接擋掉）
          const iframe = document.querySelector('iframe') as HTMLIFrameElement;
          const watchMask = (t0: number) => {
            const poll = () => {
              if (document.querySelector('[data-testid="watchdog-left-scope"]'))
                resolve({ maskDelay: performance.now() - t0 });
              else setTimeout(poll, 20);
            };
            poll();
          };
          iframe.addEventListener('load', () => watchMask(performance.now()), { once: true });
        }),
    );
    if (timing.maskDelay >= 0) expect(timing.maskDelay).toBeLessThan(1500 + 700);
    else expect(await h.status()).toBe('ready');
  });
});

test.describe('V10 while(true){}', () => {
  test('主應用 UI 仍可操作；約 6–8 秒後出現「停止 prototype」，按下去 iframe 被移除', async ({
    harness: h,
    browserName,
  }) => {
    // WebKit 尚未把跨 site 的 iframe 放進獨立 process（規格 D1 的前提不成立）：frame 卡死會連主應用的
    // main thread 一起卡死，watchdog 沒有機會執行。這是 Safari 的已知限制，列在 README 與規格 Risks。
    test.skip(
      browserName === 'webkit',
      'WebKit 沒有 per-site iframe process：無窮迴圈會凍結整個分頁',
    );
    test.setTimeout(60_000);
    await h.open('v10-infinite-loop.html'); // ready 之後 ~0.3 秒 frame 開始卡死
    const t0 = Date.now();
    // 卡死期間，主應用的輸入框要保持可操作。
    const input = h.page.getByTestId('probe-input');
    await input.fill('still responsive');
    await expect(input).toHaveValue('still responsive');
    await expect(h.page.getByTestId('status')).toHaveText('unresponsive', { timeout: 15_000 });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThan(4_500); // 3 次心跳沒回應 ≈ 6–8 秒
    expect(elapsed).toBeLessThan(10_500);
    await input.fill('typed while frame is hung');
    await expect(input).toHaveValue('typed while frame is hung');
    const stats = await h.stats();
    expect(stats.maxJitterMs).toBeLessThan(1500);
    await expect(h.page.getByTestId('watchdog-unresponsive')).toContainText(
      'prototype 無回應（可能有無窮迴圈）',
    );
    await h.page.getByRole('button', { name: '停止 prototype' }).click();
    await expect(h.page.locator('iframe')).toHaveCount(0);
    await expect(h.page.getByTestId('watchdog-stopped')).toBeVisible();
  });
});

test.describe('V11 alert() 迴圈', () => {
  test('沒有原生 dialog，toast 有節流', async ({ harness: h }) => {
    await h.open('v11-alert-flood.html');
    await h.waitForVector();
    const [r] = await h.vectorData<Dict>('result');
    expect(r?.confirm).toBe(true);
    expect(r?.prompt).toBeNull();
    const stats = await h.stats();
    const dialogs = stats.counts.dialog ?? 0;
    expect(dialogs).toBeGreaterThanOrEqual(1);
    expect(dialogs).toBeLessThanOrEqual(3); // agent 端 1 則/秒 的節流（5,000+ 次呼叫）
    expect(stats.toasts.length).toBeLessThanOrEqual(3);
    await expect(h.page.getByTestId('toast').first()).toBeVisible();
    expect(await h.page.getByTestId('toast').count()).toBeLessThanOrEqual(3);
  });
});

test.describe('V12 偽造 pick', () => {
  test('schema 通過但只以純文字顯示，沒有執行任何 script', async ({ harness: h }) => {
    await h.open('v12-spoof-pick.html');
    await h.waitForVector();
    const evil = '<img src=x onerror="window.__xss=1;alert(1)">';
    await expect(h.page.getByTestId('pick-css')).toHaveText(evil);
    await expect(h.page.getByTestId('pick-snapshot')).toHaveText(`img: ${evil}`);
    await expect(h.page.getByTestId('toast').first()).toHaveText(`alert: ${evil}`);
    expect(await h.page.locator('img').count()).toBe(0);
    expect(
      await h.page.evaluate(() => (window as unknown as { __xss?: unknown }).__xss),
    ).toBeUndefined();
    const stats = await h.stats();
    expect(stats.counts.pick).toBe(1); // 超過 1 KB 的 selector 那則被 schema 擋下
    expect(stats.dropped.schema ?? 0).toBeGreaterThanOrEqual(3);
  });
});

test.describe('V13 超大／高頻訊息', () => {
  test('1 MB 訊息被丟棄、每秒 10,000 則被節流，主應用不卡', async ({ harness: h }) => {
    test.setTimeout(60_000);
    await h.open('v13-flood.html');
    const input = h.page.getByTestId('probe-input');
    await input.fill('typing during flood');
    await h.waitForVector();
    await expect(input).toHaveValue('typing during flood');
    const stats = await h.stats();
    const [r] = await h.vectorData<{ sent: number }>('result');
    expect(r?.sent).toBeGreaterThan(10_000);
    expect(stats.dropped['too-large'] ?? 0).toBeGreaterThanOrEqual(1);
    expect(stats.dropped['rate-limited'] ?? 0).toBeGreaterThan(1000);
    // 3 秒內最多通過 ~120 則/秒（+ 初始額度）
    expect(stats.counts.hover ?? 0).toBeLessThan(800);
    expect(stats.maxJitterMs).toBeLessThan(1500);
    console.log(
      `[V13] sent=${r?.sent} accepted hover=${stats.counts.hover} dropped=${JSON.stringify(stats.dropped)} maxJitter=${Math.round(stats.maxJitterMs)}ms`,
    );
  });
});

test.describe('V14 prototype 監聽所有 message', () => {
  test('frame 收到的訊息不含 comment 內文、作者名或 token，只有協定允許的欄位', async ({
    harness: h,
  }) => {
    test.setTimeout(60_000);
    await h.open('v14-message-spy.html');
    await h.waitForVector('messages', 20_000);
    const [seen] = await h.vectorData<{ fromParent: boolean; json: string }[]>('messages');
    expect(seen?.length).toBeGreaterThanOrEqual(3);
    const types = new Set<string>();
    const allowed: Record<string, string[]> = {
      init: ['v', 'type', 'mode', 'storageSeed'],
      trackAnchors: ['v', 'type', 'threadIds'],
      ping: ['v', 'type', 'seq'],
      setMode: ['v', 'type', 'mode'],
    };
    for (const m of seen ?? []) {
      for (const secret of SECRETS) expect(m.json).not.toContain(secret);
      expect(m.json).not.toMatch(/SECRET/i);
      const parsed = JSON.parse(m.json.replace(/^onmessage:/, '')) as Dict;
      types.add(String(parsed.type));
      expect(
        allowed[String(parsed.type)],
        `unexpected message type ${String(parsed.type)}`,
      ).toBeDefined();
      expect(Object.keys(parsed).every((k) => allowed[String(parsed.type)]?.includes(k))).toBe(
        true,
      );
    }
    // 不是空轉：parent 確實送了 init、trackAnchors 與心跳。
    for (const t of ['init', 'trackAnchors', 'ping']) expect(types.has(t), `saw ${t}`).toBe(true);
    // parent 自己的畫面上確實有機密（證明 sentinel 存在於 parent 狀態）。
    await expect(h.page.getByTestId('parent-comment')).toContainText('SECRET-COMMENT-BODY');
  });
});

test.describe('V15 直接用網址開 content URL', () => {
  test('CSP sandbox header 生效：origin 為 null，原生 storage／cookie／indexedDB 丟 SecurityError', async ({
    page,
    servers,
  }) => {
    const url = `http://${TEST_KEY}.${CONTENT_BASE_DOMAIN}/v15-direct-open.html`;
    const res = await page.goto(url);
    expect(res?.headers()['content-security-policy']).toMatch(/^sandbox allow-scripts;/);
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { __vectorResults?: unknown[] }).__vectorResults?.length ?? 0,
        ),
      )
      .toBeGreaterThan(1);
    const results = await page.evaluate(
      () =>
        (window as unknown as { __vectorResults: { name: string; data: Dict }[] }).__vectorResults,
    );
    const r = results.find((x) => x.name === 'result')?.data;
    expect(r?.origin).toBe('null');
    expect(r?.isTop).toBe(true);
    const native = r?.native as Dict;
    expect(native.timeout).toBeUndefined();
    expect(native.origin).toBe('null');
    expect(native.localStorage).toBe('SecurityError');
    expect(native.sessionStorage).toBe('SecurityError');
    // 規格要求丟 SecurityError；WebKit 改成回傳空字串。兩者都讀不到任何 cookie。
    expect(['SecurityError', '']).toContain(native.cookie);
    expect(native.indexedDB).toBe('SecurityError');
    expect(r?.polyfilledLocalStorage).toBe('v'); // agent polyfill 讓 prototype 自己的程式不會壞
    expect(servers.evil.requests()).toHaveLength(0);
  });
});

test.describe('V16 含 <script> 的 SVG 直接開網址', () => {
  test('和 V15 相同：origin 為 null，storage 丟 SecurityError', async ({ page }) => {
    const res = await page.goto(`http://${TEST_KEY}.${CONTENT_BASE_DOMAIN}/v16-svg.svg`);
    expect(res?.headers()['content-type']).toBe('image/svg+xml');
    expect(res?.headers()['content-security-policy']).toMatch(/^sandbox allow-scripts;/);
    const data = await page.evaluate(
      () => document.getElementById('s')?.getAttribute('data-result') ?? '',
    );
    const r = JSON.parse(data) as Dict;
    expect(r.origin).toBe('null');
    expect(r.localStorage).toBe('SecurityError');
    expect(r.cookie).toBe('SecurityError');
  });
});

test.describe('V18 Permissions-Policy', () => {
  test('geolocation／getUserMedia／clipboard.readText 都被拒絕（即使瀏覽器已授權）', async ({
    page,
    context,
    browserName,
  }) => {
    // 直接開 content URL 時只剩 response header 可以擋；Firefox 會讓 getUserMedia 的權限提示一直等待、
    // WebKit 的 camera 在最上層文件不遵守 header。實際使用情境（iframe + allow=""）由下一個測試在三個瀏覽器驗證。
    test.skip(browserName !== 'chromium', '僅 Chromium 完整支援以 header 拒絕權限的直接開啟情境');
    for (const permission of ['geolocation', 'camera', 'microphone', 'clipboard-read']) {
      await context.grantPermissions([permission]).catch(() => {}); // 部分瀏覽器不支援該權限名稱
    }
    // 直接開（只靠 response header）
    const res = await page.goto(`http://${TEST_KEY}.${CONTENT_BASE_DOMAIN}/v18-permissions.html`);
    expect(res?.headers()['permissions-policy']).toContain('geolocation=()');
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (window as unknown as { __vectorResults?: unknown[] }).__vectorResults?.some(
                (x) => (x as { name: string }).name === 'done',
              ) ?? false,
          ),
        { timeout: 15_000 },
      )
      .toBe(true);
    const results = await page.evaluate(
      () =>
        (window as unknown as { __vectorResults: { name: string; data: Dict }[] }).__vectorResults,
    );
    const r = results.find((x) => x.name === 'result')?.data ?? {};
    for (const [api, outcome] of Object.entries(r))
      expect(String(outcome), api).not.toBe('granted');
    expect(String(r.geolocation)).toMatch(/^denied:1$|^threw:/);
  });

  test('在 iframe（allow="" 加 header）裡同樣被拒絕', async ({ harness: h }) => {
    await h.open('v18-permissions.html');
    await h.waitForVector('done', 20_000);
    const [r] = await h.vectorData<Dict>('result');
    for (const [api, outcome] of Object.entries(r ?? {}))
      expect(String(outcome), api).not.toBe('granted');
  });
});

test.describe('V23 content 端：已輪替的 contentKey', () => {
  test('未知 key 回 404（空 body）', async () => {
    const r = await contentGet('/', { key: UNKNOWN_KEY });
    expect(r.status).toBe(404);
    expect(r.body).toBe('');
  });

  test('輪替後舊 key 立即 404，新 key 可用；agent 與資源同樣 404', async ({ servers }) => {
    const oldKey = 'oldoldoldoldoldoldoldoldol';
    const newKey = 'newnewnewnewnewnewnewnewne';
    servers.resolver.set(oldKey, { dir: VECTORS_DIR });
    expect((await contentGet('/v01-parent-access.html', { key: oldKey })).status).toBe(200);
    servers.resolver.revoke(oldKey);
    servers.resolver.set(newKey, { dir: VECTORS_DIR });
    for (const path of ['/v01-parent-access.html', '/', '/data.json', '/__hpe/agent.v1.js']) {
      const old = await contentGet(path, { key: oldKey });
      expect(old.status, path).toBe(404);
      expect(old.body).toBe('');
    }
    expect((await contentGet('/v01-parent-access.html', { key: newKey })).status).toBe(200);
    servers.resolver.revoke(newKey);
  });
});

test.describe('V24 clickjacking', () => {
  test('主應用被別的 origin 的 <iframe> 嵌入時被 frame-ancestors 擋下', async ({
    page,
    servers,
  }) => {
    const res = await page.request.get(`${APP_ORIGIN}/harness.html`);
    expect(res.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
    servers.evil.reset();
    await page.goto(`${EVIL_ORIGIN}/embed-harness`);
    const frameEl = page.locator('#victim');
    await expect(frameEl).toBeVisible();
    await page.waitForTimeout(1500);
    const children = page.frames().filter((f) => f !== page.mainFrame());
    expect(children.length).toBeGreaterThan(0);
    for (const f of children) {
      expect(await f.locator('[data-testid="harness-root"]').count(), `frame ${f.url()}`).toBe(0);
      expect(
        f.url().startsWith(`${APP_ORIGIN}/harness.html`) && (await f.locator('#root').count()) > 0,
      ).toBe(false);
    }
  });
});

test.describe('content server 回應 header（HTML，spec 逐字）', () => {
  test('完整 header 集合', async () => {
    const r = await contentGet('/v01-parent-access.html');
    expect(r.status).toBe(200);
    const csp = String(r.headers['content-security-policy']);
    expect(csp).toBe(
      `sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'self' http://${TEST_KEY}.${CONTENT_BASE_DOMAIN}; frame-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors ${APP_ORIGIN}; report-to csp-endpoint`,
    );
    expect(r.headers['permissions-policy']).toBe(
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), clipboard-read=(), display-capture=()',
    );
    expect(r.headers['referrer-policy']).toBe('no-referrer');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['cross-origin-resource-policy']).toBe('same-site');
    expect(r.headers['cache-control']).toBe('private, max-age=300');
    expect(r.body).toContain(
      '<script src="/__hpe/agent.v1.js" data-hpe-page="v01-parent-access.html"></script>',
    );
  });
});
