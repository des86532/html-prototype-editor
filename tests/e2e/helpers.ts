import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type FrameLocator, type Locator, type Page } from '@playwright/test';
import { ORIGINS, ROOT } from './stack';

export const FIXTURE_DIR = join(ROOT, 'tests/e2e/fixtures/proto');

/** 把 fixtures/proto 打成 zip（用系統 zip，CI ubuntu 與 macOS 都有）。 */
export function buildFixtureZip(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hpe-e2e-zip-'));
  const out = join(dir, 'proto.zip');
  execFileSync('zip', ['-qr', out, 'index.html', 'pricing.html', 'external.html', 'assets'], {
    cwd: FIXTURE_DIR,
  });
  return out;
}

/** 開發登入（DEV_LOGIN=true 時 POST /auth/dev-login 直接以 email 登入；e2e 不可能走真的 Google）。 */
export async function login(page: Page, email: string): Promise<void> {
  // page.request 與頁面共用同一個 context 的 cookie
  const res = await page.request.post(`${ORIGINS.api}/auth/dev-login`, { data: { email } });
  expect(res.ok()).toBeTruthy();
  await page.goto(`${ORIGINS.web}/projects`);
  await page.waitForURL(`${ORIGINS.web}/projects`);
}

export async function createProjectViaUi(page: Page, name: string): Promise<string> {
  await page.getByLabel('新專案名稱').fill(name);
  await page.getByRole('button', { name: '建立專案' }).click();
  await page.waitForURL(/\/p\/[^/]+$/);
  return page.url().split('/p/')[1]!;
}

export interface ViewerHandles {
  page: Page;
  frame: FrameLocator;
  wrapper: Locator;
}

export function viewerHandles(page: Page): ViewerHandles {
  return {
    page,
    frame: page.frameLocator('iframe[title^="Prototype"]'),
    wrapper: page.getByTestId('sandbox-frame-wrapper'),
  };
}

/** 等 agent 的 ready（頁面選單已經填入目前頁面）。 */
export async function waitForViewerReady(page: Page): Promise<void> {
  await expect(page.getByTestId('sandbox-frame-wrapper')).toBeVisible();
  await expect(page.getByRole('combobox', { name: '頁面' })).toHaveValue(/.+/);
  await expect(page.locator('iframe[title^="Prototype"]')).toBeVisible();
  // 等 frame 內的內容真的畫出來
  await expect(viewerHandles(page).frame.locator('body')).toBeVisible();
  // 樣式表載入前量到的座標會是未套樣式的版面：等 fixture 的 CSS 生效再回傳
  await expect(viewerHandles(page).frame.locator('.nav')).toHaveCSS('display', 'flex');
}

export async function frameWindow(page: Page) {
  const handle = await page.locator('iframe[title^="Prototype"]').elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error('prototype frame not found');
  return frame;
}

/** 進入標記模式：點「標記（C）」並等浮動工具盤出現。 */
export async function enterMarkupMode(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^標記（C）/ }).click();
  await expect(page.getByRole('toolbar', { name: '標記工具' })).toBeVisible();
  await expect(page.getByTestId('markup-canvas')).toBeVisible();
}

/** 標記畫布目前的縮放與捲動（從 svg 的 width／viewBox 推算，不依賴 viewer 內部狀態）。 */
export async function canvasMetrics(page: Page): Promise<{
  box: { x: number; y: number; width: number; height: number };
  scale: number;
  scrollX: number;
  scrollY: number;
}> {
  const svg = page.getByTestId('markup-svg');
  const box = await page.getByTestId('markup-canvas').boundingBox();
  if (!box) throw new Error('markup canvas not visible');
  const width = Number(await svg.getAttribute('width'));
  const vb = ((await svg.getAttribute('viewBox')) ?? '0 0 1 1').split(/\s+/).map(Number);
  return { box, scale: width / vb[2]!, scrollX: vb[0]!, scrollY: vb[1]! };
}

/** 頁面座標 → 螢幕座標（以標記畫布為準）。 */
export async function pageToScreen(
  page: Page,
  p: { x: number; y: number },
): Promise<{ x: number; y: number }> {
  const m = await canvasMetrics(page);
  return { x: m.box.x + (p.x - m.scrollX) * m.scale, y: m.box.y + (p.y - m.scrollY) * m.scale };
}

/** 在標記畫布上用目前工具從 from 拖到 to（頁面座標；要在標記模式下呼叫）。 */
export async function dragOnCanvas(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  const a = await pageToScreen(page, from);
  const b = await pageToScreen(page, to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
}

/** 預設工具就是矩形：在標記畫布上畫一個矩形。 */
export async function drawRect(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await page.getByRole('button', { name: /^矩形（R）/ }).click();
  await dragOnCanvas(page, from, to);
}
