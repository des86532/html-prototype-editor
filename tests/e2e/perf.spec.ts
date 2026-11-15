import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { ORIGINS } from './stack';
import { buildFixtureZip, login, waitForViewerReady } from './helpers';

/**
 * 效能預算：200 個標記時，捲動中 scroll 訊息到 SVG viewBox 更新 < 16 ms。
 *
 * 量測的是 parent 收到 frame 的 `scroll` 訊息，到標記 SVG 的 viewBox 屬性真的寫進 DOM 的時間
 * （MutationObserver 回呼），涵蓋 zod 驗證與 React commit。捲動時只有 viewBox 與 badge 容器的 transform
 * 會變，ShapeSvg 被 memo 住，200 個標記不應重畫。
 * 測的是 production 建置（tests/e2e/stack.ts 以 NODE_ENV=production 建置主應用）。
 */
type Sample = { ms: number };

test('200 個標記：scroll 訊息到 SVG 更新的 p95 < 16 ms', async ({ page, browserName }) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    const w = window as unknown as { __lat: { ms: number }[]; __lastScroll: number };
    w.__lat = [];
    w.__lastScroll = 0;
    window.addEventListener(
      'message',
      (e) => {
        const d = e.data as { type?: string } | null;
        if (e.source !== window && d && d.type === 'scroll') w.__lastScroll = performance.now();
      },
      true,
    );
    const attach = () => {
      const svg = document.querySelector('svg[data-testid=markup-svg]');
      if (!svg) return false;
      new MutationObserver(() => {
        if (!w.__lastScroll) return;
        w.__lat.push({ ms: performance.now() - w.__lastScroll });
        w.__lastScroll = 0;
      }).observe(svg, { attributes: true, attributeFilter: ['viewBox'] });
      return true;
    };
    // svg 在 viewer 掛載後才出現：觀察 document 直到找到它（找到後只掛一次）
    const boot = new MutationObserver(() => {
      if (attach()) boot.disconnect();
    });
    boot.observe(document, { subtree: true, childList: true });
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

  // 200 個矩形：每列 10 個、間距 120px、y 從 0 到 2400
  for (let i = 0; i < 200; i++) {
    const r = await page.request.post(`${ORIGINS.api}/versions/${version.id}/threads`, {
      data: {
        markup: {
          pageId: 'index.html',
          viewport: { width: 1440, height: 900 },
          shape: {
            kind: 'rect',
            x: 40 + (i % 10) * 120,
            y: Math.floor(i / 10) * 120,
            w: 80,
            h: 60,
            color: '#e5484d',
            stroke: 2,
          },
        },
        body: `mark ${i}`,
      },
    });
    expect(r.status()).toBe(201);
  }

  await page.goto(`${ORIGINS.web}/p/${project.project.id}/v/1`);
  await waitForViewerReady(page);
  await expect(page.locator('[data-testid="markup-svg"] [data-shape-kind]')).toHaveCount(200, {
    timeout: 15_000,
  });

  const fw = (await (await page
    .locator('iframe[title^="Prototype"]')
    .elementHandle())!.contentFrame())!;
  // 往下 600px 再回到 0，每次 scrollBy(0, 40)。
  // 每一步都等到 viewBox 更新才捲下一步：樣本數不取決於機器速度（慢的 CI runner 上
  // 固定間隔的捲動會被合併成很少的訊息）。
  const step = async (dy: number) => {
    const before = await page.evaluate(
      () => (window as unknown as { __lat: unknown[] }).__lat.length,
    );
    await fw.evaluate((d) => window.scrollBy(0, d), dy);
    await page
      .waitForFunction(
        (n) => (window as unknown as { __lat: unknown[] }).__lat.length > n,
        before,
        { timeout: 500 },
      )
      .catch(() => undefined);
  };
  const pass = async () => {
    for (let i = 0; i < 15; i++) await step(40);
    for (let i = 0; i < 15; i++) await step(-40);
    await page.waitForTimeout(200);
  };
  await pass(); // 暖機（JIT、首次 layout）
  await page.evaluate(() => {
    (window as unknown as { __lat: unknown[] }).__lat.length = 0;
  });
  await pass();
  await pass();

  const all: Sample[] = await page.evaluate(() => (window as unknown as { __lat: Sample[] }).__lat);
  const samples = all.map((s) => s.ms);
  expect(samples.length).toBeGreaterThan(25);
  const pct = (xs: number[], p: number) =>
    [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))] ?? 0;
  console.log(
    `[perf ${browserName}] n=${samples.length} median=${pct(samples, 0.5).toFixed(1)}ms p95=${pct(samples, 0.95).toFixed(1)}ms`,
  );
  // 預算：scroll 訊息 → viewBox 更新 p95 < 16 ms
  expect(pct(samples, 0.95)).toBeLessThan(16);
});
