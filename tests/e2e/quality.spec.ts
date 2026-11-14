import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { zipSync } from 'fflate';
import { expect, test } from '@playwright/test';
import { ORIGINS } from './stack';
import { FIXTURE_DIR, buildFixtureZip, login, waitForViewerReady } from './helpers';

/** 規格 Verification §3：a11y、Viewer 首次可互動、50 MB zip 匯入、鍵盤操作。 */
test.describe.configure({ mode: 'serial' });

const EMAIL = `quality-${Date.now()}@example.com`;
let projectId = '';
let versionId = '';

test.beforeEach(async ({ page }, info) => {
  await page.setViewportSize({ width: 1500, height: 950 });
  // 每個測試都是新的 context：除了第一個（自己登入並建立資料）以外，先以同一個帳號登入
  if (!info.title.startsWith('準備') && !info.title.startsWith('50 MB')) await login(page, EMAIL);
});

test('準備：登入、匯入 fixture、建立一則評論', async ({ page }) => {
  await login(page, EMAIL);
  const p = (await (
    await page.request.post(`${ORIGINS.api}/projects`, { data: { name: 'quality' } })
  ).json()) as { project: { id: string } };
  projectId = p.project.id;
  const v = await page.request.post(`${ORIGINS.api}/projects/${projectId}/versions`, {
    multipart: {
      file: { name: 'p.zip', mimeType: 'application/zip', buffer: readFileSync(buildFixtureZip()) },
    },
  });
  versionId = ((await v.json()) as { version: { id: string } }).version.id;
  const t = await page.request.post(`${ORIGINS.api}/versions/${versionId}/threads`, {
    data: {
      anchor: {
        pageId: 'index.html',
        kind: 'element',
        viewport: { width: 1440, height: 900, dpr: 1 },
        selectors: {
          css: '#cta',
          dataAttr: { name: 'data-testid', value: 'cta' },
          fingerprint: {
            tag: 'button',
            classes: ['btn'],
            textHash: 'h',
            siblingIndex: 0,
            depth: 4,
          },
          elementOffset: { x: 0.5, y: 0.5 },
        },
        fallback: { x: 0, y: 0, w: 10, h: 10 },
        snapshot: { tag: 'button', text: 'Get started' },
      },
      body: '請把按鈕文案改成「立即開始」。',
    },
  });
  expect(t.status()).toBe(201);
});

test('Viewer 首次可互動 < 2.5 秒（本機）', async ({ page }) => {
  const t0 = Date.now();
  await page.goto(`${ORIGINS.web}/p/${projectId}/v/1`);
  await waitForViewerReady(page);
  await expect(page.locator('[data-pin-id]')).toHaveCount(1);
  // 可互動 = pin 已出現且可以點開卡片
  await page.getByRole('button', { name: /^評論 #1/ }).click();
  await expect(page.getByRole('dialog', { name: /討論串/ })).toBeVisible();
  const ms = Date.now() - t0;
  console.log(`[quality] viewer interactive in ${ms}ms`);
  expect(ms).toBeLessThan(2500);
});

test('axe：主應用 0 個 critical（專案列表、專案頁、Viewer + 卡片 + 留言面板）', async ({
  page,
}) => {
  const critical = async (label: string) => {
    const r = await new AxeBuilder({ page }).analyze();
    const bad = r.violations.filter((v) => v.impact === 'critical');
    if (bad.length)
      console.log(label, JSON.stringify(bad.map((b) => [b.id, b.nodes.map((n) => n.target)])));
    const serious = r.violations.filter((v) => v.impact === 'serious').map((v) => v.id);
    console.log(`[axe] ${label}: critical=${bad.length} serious=[${serious.join(',')}]`);
    expect(bad, label).toHaveLength(0);
  };
  await page.goto(`${ORIGINS.web}/projects`);
  await expect(page.getByLabel('新專案名稱')).toBeVisible();
  await critical('projects');

  await page.goto(`${ORIGINS.web}/p/${projectId}`);
  await expect(page.getByRole('button', { name: '匯入新版本' })).toBeVisible();
  await critical('project');

  await page.goto(`${ORIGINS.web}/p/${projectId}/v/1`);
  await waitForViewerReady(page);
  await expect(page.locator('[data-pin-id]')).toHaveCount(1);
  await critical('viewer');
  await page.getByRole('button', { name: /^評論 #1/ }).click();
  await expect(page.getByRole('dialog', { name: /討論串/ })).toBeVisible();
  await critical('viewer + card');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^留言面板/ }).click();
  await expect(page.getByTestId('comment-panel')).toBeVisible();
  await critical('viewer + panel');
});

test('只用鍵盤：Tab 到 pin → Enter 開卡片（焦點移入）→ Esc 關閉（焦點回到 pin）；J/K、Shift+C', async ({
  page,
}) => {
  await page.goto(`${ORIGINS.web}/p/${projectId}/v/1`);
  await waitForViewerReady(page);
  const pin = page.getByRole('button', { name: /^評論 #1/ });
  await expect(pin).toBeVisible();
  await pin.focus();
  await page.keyboard.press('Enter');
  const card = page.getByRole('dialog', { name: /討論串/ });
  await expect(card).toBeVisible();
  await expect(pin).toHaveAttribute('aria-expanded', 'true');
  // 焦點移入卡片
  await expect.poll(() => card.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await expect(pin).toBeFocused();
  await expect(pin).toHaveAttribute('aria-expanded', 'false');

  // J 開啟（下一則）卡片，Shift+C 隱藏／顯示所有 pin
  await page.keyboard.press('j');
  await expect(card).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+C');
  await expect(page.locator('[data-pin-id]')).toHaveCount(0);
  await page.keyboard.press('Shift+C');
  await expect(page.locator('[data-pin-id]')).toHaveCount(1);

  // 留言面板可用鍵盤開啟、項目可聚焦並以 Enter 選取
  await page.getByRole('button', { name: /^留言面板/ }).focus();
  await page.keyboard.press('Enter');
  const panel = page.getByTestId('comment-panel');
  await expect(panel).toBeVisible();
  await panel
    .getByRole('button', { name: /評論 #1|#1/ })
    .first()
    .focus();
  await page.keyboard.press('Enter');
  await expect(card).toBeVisible();
});

test('50 MB zip 匯入 < 10 秒（上限內的最大壓縮檔，內容為難以壓縮的資料）', async ({ page }) => {
  test.setTimeout(120_000);
  // 49 MB 的不可壓縮資料（zip 在 50 MB 上限內）＋ fixture 頁面。為了貼近 50 MB，store 不壓縮。
  const filler = new Uint8Array(49 * 1024 * 1024);
  let seed = 123456789;
  for (let i = 0; i < filler.length; i += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    filler[i] = seed & 255;
    filler[i + 1] = (seed >>> 8) & 255;
    filler[i + 2] = (seed >>> 16) & 255;
    filler[i + 3] = (seed >>> 24) & 255;
  }
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    'index.html': readFileSync(`${FIXTURE_DIR}/index.html`),
    'assets/style.css': readFileSync(`${FIXTURE_DIR}/assets/style.css`),
    'assets/app.js': readFileSync(`${FIXTURE_DIR}/assets/app.js`),
    'assets/pixel.png': readFileSync(`${FIXTURE_DIR}/assets/pixel.png`),
    'assets/big.mp4': [filler, { level: 0 }],
  };
  const zip = zipSync(files as Parameters<typeof zipSync>[0]);
  expect(zip.length).toBeGreaterThan(48 * 1024 * 1024);
  expect(zip.length).toBeLessThan(50 * 1024 * 1024);
  await login(page, `big${Date.now()}@example.com`);
  const p = (await (
    await page.request.post(`${ORIGINS.api}/projects`, { data: { name: 'big' } })
  ).json()) as { project: { id: string } };
  const t0 = Date.now();
  const res = await page.request.post(`${ORIGINS.api}/projects/${p.project.id}/versions`, {
    multipart: { file: { name: 'big.zip', mimeType: 'application/zip', buffer: Buffer.from(zip) } },
    timeout: 60_000,
  });
  const ms = Date.now() - t0;
  console.log(
    `[quality] ${(zip.length / 1048576).toFixed(1)} MB zip imported in ${ms}ms (status ${res.status()})`,
  );
  expect(res.status()).toBe(201);
  expect(ms).toBeLessThan(10_000);
  // 確認真的存進去了（不是被靜默略過）
  const vid = ((await res.json()) as { version: { id: string } }).version.id;
  const est = (await (
    await page.request.get(`${ORIGINS.api}/versions/${vid}/export-estimate`)
  ).json()) as {
    packageBytes: number;
  };
  expect(est.packageBytes).toBeGreaterThan(48 * 1024 * 1024);
});
