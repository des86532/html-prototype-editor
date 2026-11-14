import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { ORIGINS } from './stack';
import { buildFixtureZip, login, waitForViewerReady } from './helpers';

/**
 * 效能預算（規格 Verification §3）：200 個 pin 時，捲動中 geometry 更新到重新繪製 < 16 ms。
 *
 * 量測的是 parent 收到 frame 的 `geometry` 訊息，到 overlay 的 pin 位置真的寫進 DOM 的時間
 * （MutationObserver 回呼），涵蓋 zod 驗證、React 重新計算 200 個 pin 與 commit。
 * 測的是 production 建置（tests/e2e/stack.ts 以 NODE_ENV=production 建置主應用）。
 * agent 端的量測成本由 frame-agent 的 200-anchor 單元測試與 getBoundingClientRect 本身決定。
 */
type Sample = { ms: number; transition: boolean };

test('200 個 pin：geometry 訊息到 pin 位置更新進 DOM 的 p95 < 16 ms', async ({
  page,
  browserName,
}) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    const w = window as unknown as {
      __lat: { ms: number; transition: boolean }[];
      __lastGeo: number;
      __pinCount: number;
    };
    w.__lat = [];
    w.__lastGeo = 0;
    w.__pinCount = 0;
    window.addEventListener(
      'message',
      (e) => {
        const d = e.data as { type?: string } | null;
        if (e.source !== window && d && d.type === 'geometry') w.__lastGeo = performance.now();
      },
      true,
    );
    new MutationObserver(() => {
      if (!w.__lastGeo) return;
      // pin 進出可視區（pin 與邊緣箭頭互換）時 pin 數量會變：這是一次性的 mount/unmount 突波，另外統計
      const count = document.querySelectorAll('[data-pin-id]').length;
      w.__lat.push({ ms: performance.now() - w.__lastGeo, transition: count !== w.__pinCount });
      w.__pinCount = count;
      w.__lastGeo = 0;
    }).observe(document, {
      subtree: true,
      attributes: true,
      childList: true,
      attributeFilter: ['style', 'data-x', 'data-y'],
    });
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await login(page, `perf${Date.now()}@example.com`);
  const project = (await (
    await page.request.post(`${ORIGINS.api}/projects`, { data: { name: 'perf' } })
  ).json()) as { project: { id: string } };
  const created = await page.request.post(
    `${ORIGINS.api}/projects/${project.project.id}/versions`,
    {
      multipart: {
        file: {
          name: 'p.zip',
          mimeType: 'application/zip',
          buffer: readFileSync(buildFixtureZip()),
        },
      },
    },
  );
  const version = ((await created.json()) as { version: { id: string } }).version;

  const anchorFor = (css: string, text: string, i: number) => ({
    pageId: 'index.html',
    kind: 'element',
    viewport: { width: 1440, height: 900, dpr: 1 },
    selectors: {
      css,
      fingerprint: {
        tag: 'button',
        classes: ['btn'],
        textHash: `h${i}`,
        siblingIndex: 0,
        depth: 4,
      },
      elementOffset: { x: (i % 10) / 10, y: ((i * 3) % 10) / 10 },
    },
    fallback: { x: 0, y: 0, w: 10, h: 10 },
    snapshot: { tag: 'button', text },
  });
  // 100 個在 #cta（畫面內）、100 個在 #below-fold（畫面外 → 邊緣箭頭）。
  // 200 個 anchor 序列化後超過 64 KB：同時驗證 resolveAnchors 依大小切批（單一訊息超限會被 agent 丟棄）。
  for (let i = 0; i < 200; i++) {
    const r = await page.request.post(`${ORIGINS.api}/versions/${version.id}/threads`, {
      data:
        i % 2
          ? { anchor: anchorFor('#cta', 'Get started', i), body: `pin ${i}` }
          : { anchor: anchorFor('#below-fold', 'Below the fold', i), body: `pin ${i}` },
    });
    expect(r.status()).toBe(201);
  }

  await page.goto(`${ORIGINS.web}/p/${project.project.id}/v/1`);
  await waitForViewerReady(page);
  await expect(page.locator('[data-pin-id]')).toHaveCount(100, { timeout: 15_000 });
  await expect(page.locator('[data-testid^="edge-"]')).toHaveCount(100);

  const fw = (await (await page
    .locator('iframe[title^="Prototype"]')
    .elementHandle())!.contentFrame())!;
  // 0 → 600px → 0：#cta 的 100 個 pin 在途中捲出畫面再回來（pin 與邊緣箭頭互換）
  // 每一步都等到收到對應的 geometry 訊息才捲下一步：樣本數不取決於機器速度（慢的 CI runner 上
  // 固定間隔的捲動會被合併成很少的訊息）。
  const step = async (y: number) => {
    const before = await page.evaluate(
      () => (window as unknown as { __lat: unknown[] }).__lat.length,
    );
    await fw.evaluate((yy) => window.scrollTo(0, yy), y);
    await page
      .waitForFunction(
        (n) => (window as unknown as { __lat: unknown[] }).__lat.length > n,
        before,
        { timeout: 500 },
      )
      .catch(() => undefined);
  };
  const pass = async () => {
    for (let y = 0; y <= 600; y += 24) await step(y);
    for (let y = 600; y >= 0; y -= 24) await step(y);
    await page.waitForTimeout(200);
  };
  await pass(); // 暖機（JIT、首次 layout）
  await page.evaluate(() => {
    const w = window as unknown as { __lat: unknown[]; __pinCount: number };
    w.__lat.length = 0;
    w.__pinCount = document.querySelectorAll('[data-pin-id]').length;
  });
  await pass();
  await pass();

  const all: Sample[] = await page.evaluate(() => (window as unknown as { __lat: Sample[] }).__lat);
  const steady = all.filter((s) => !s.transition).map((s) => s.ms);
  const transitions = all.filter((s) => s.transition).map((s) => s.ms);
  expect(steady.length).toBeGreaterThan(25);
  const pct = (xs: number[], p: number) =>
    [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))] ?? 0;
  console.log(
    `[perf ${browserName}] steady: n=${steady.length} median=${pct(steady, 0.5).toFixed(1)}ms p95=${pct(steady, 0.95).toFixed(1)}ms | ` +
      `pin<->arrow transitions (100 pins mount/unmount): n=${transitions.length} max=${Math.max(0, ...transitions).toFixed(1)}ms`,
  );
  // 預算：pin 集合不變時，geometry 訊息 → DOM 更新 p95 < 16 ms
  expect(pct(steady, 0.95)).toBeLessThan(16);
  // 一次換 100 個 pin（mount/unmount）是一次性突波，不套用 16 ms，但不能退化成明顯卡頓
  expect(Math.max(0, ...transitions)).toBeLessThan(50);
});
