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

/** pin 錨點（overlay 座標）轉成頁面座標。 */
export async function pinPagePoint(page: Page, testId: string): Promise<{ x: number; y: number }> {
  const pin = page.getByTestId(testId);
  const wrapper = await page.getByTestId('sandbox-frame-wrapper').boundingBox();
  if (!wrapper) throw new Error('wrapper not visible');
  const x = Number(await pin.getAttribute('data-x'));
  const y = Number(await pin.getAttribute('data-y'));
  return { x: wrapper.x + x, y: wrapper.y + y };
}

export async function frameWindow(page: Page) {
  const handle = await page.locator('iframe[title^="Prototype"]').elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error('prototype frame not found');
  return frame;
}

/** 進入 Comment 模式並等 agent 真的切換完成（hover 高亮框出現代表 setMode 已生效）。 */
export async function enterCommentMode(page: Page, probe: { x: number; y: number }): Promise<void> {
  await page.getByRole('button', { name: /^Comment/ }).click();
  // 跨 process 的 iframe 在剛切換模式時可能丟掉第一個 mousemove；使用者會持續移動滑鼠，測試也一樣。
  let i = 0;
  await expect(async () => {
    await page.mouse.move(probe.x + (i++ % 3), probe.y);
    await expect(page.getByTestId('hover-highlight')).toBeVisible({ timeout: 300 });
  }).toPass({ timeout: 10_000 });
}
