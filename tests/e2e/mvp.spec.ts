import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { ORIGINS } from './stack';
import {
  buildFixtureZip,
  canvasMetrics,
  createProjectViaUi,
  dragOnCanvas,
  drawRect,
  enterMarkupMode,
  frameWindow,
  login,
  waitForViewerReady,
} from './helpers';

/**
 * 端到端流程：
 * 擁有者匯入多頁 zip → 安全報告 → 畫矩形並附說明（popover、編號、面板） → 捲動 → RWD 與其他寬度 chip →
 * 換頁 → 分享連結 → 訪客畫箭頭並附說明 → 擁有者回覆並標記解決 → 匯出全部格式 → 撤銷分享。
 */
test.describe.configure({ mode: 'serial' });

const OWNER_EMAIL = `owner-${Date.now()}@example.com`;

let ownerContext: BrowserContext;
let owner: Page;
let projectId = '';
let versionId = '';
let shareToken = '';
let shareUrl = '';

test.beforeAll(async ({ browser }) => {
  ownerContext = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  owner = await ownerContext.newPage();
  if (process.env.E2E_DEBUG)
    owner.on('console', (m) => console.log('[console]', m.type(), m.text()));
  owner.on('pageerror', (e) => console.log('[pageerror]', e.message));
  owner.on('dialog', (d) => {
    throw new Error(`unexpected native dialog: ${d.message()}`);
  });
  await login(owner, OWNER_EMAIL);
});

test.afterAll(async () => {
  await ownerContext?.close();
});

async function openViewer(page: Page, url: string) {
  await page.goto(url);
  await waitForViewerReady(page);
}

const badges = (page: Page) => page.locator('button[data-markup-id]');

test('擁有者匯入多頁 zip，安全報告列出外部資源', async () => {
  projectId = await createProjectViaUi(owner, 'E2E Demo');
  await owner.getByRole('button', { name: '匯入新版本' }).click();
  await owner.locator('input[type=file]').setInputFiles(buildFixtureZip());
  await owner.getByRole('button', { name: '匯入', exact: true }).click();
  await expect(owner.getByText('已匯入 v1')).toBeVisible();

  // 安全報告：pricing.html 引用的外部資源都應被列出，且在嚴格離線預設下是 blocked
  const report = owner
    .getByText('安全性報告')
    .locator('xpath=ancestor::*[self::section or self::div][1]');
  await expect(report).toBeVisible();
  const dialogText = await owner.locator('body').innerText();
  expect(dialogText).toContain('cdn.jsdelivr.net');
  expect(dialogText).toContain('fonts.googleapis.com');
  expect(dialogText).toContain('tracker.evil.example');

  const detail = await owner.request.get(`${ORIGINS.api}/projects/${projectId}`);
  const body = (await detail.json()) as { versions: { id: string; pages: { path: string }[] }[] };
  versionId = body.versions[0]!.id;
  expect(body.versions[0]!.pages.map((p) => p.path).sort()).toEqual([
    'external.html',
    'index.html',
    'pricing.html',
  ]);
  await owner.getByRole('button', { name: '完成' }).click();
});

test('畫矩形 → popover 聚焦「新增說明」→ 送出後顯示編號 1，面板列出 #1', async () => {
  await openViewer(owner, `${ORIGINS.web}/p/${projectId}/v/1`);
  await enterMarkupMode(owner);
  await drawRect(owner, { x: 100, y: 300 }, { x: 320, y: 380 });

  // rect 畫完自動選取：popover 開啟，說明輸入框取得焦點
  const card = owner.getByTestId('thread-popover');
  await expect(card).toBeVisible();
  await expect(card.locator('textarea')).toBeFocused();
  await expect(card.getByLabel('新增說明')).toBeFocused();
  await card.locator('textarea').fill('按鈕文案太平淡，建議改成「立即開始」。');
  await card.getByRole('button', { name: '送出' }).click();

  await expect(card).toContainText('按鈕文案太平淡');
  await expect(badges(owner)).toHaveCount(1);
  await expect(badges(owner).first()).toHaveText('1');
  await expect(owner.getByRole('button', { name: /^標記 #1/ })).toBeVisible();

  await owner.getByRole('button', { name: /^標記面板/ }).click();
  await expect(owner.getByTestId('markup-panel')).toContainText('#1');
  await owner.getByRole('button', { name: '收合標記面板' }).click();
  await owner.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
});

test('整頁縮放：預設不需捲動，+／0 縮放後標記仍貼齊形狀', async () => {
  const badge = badges(owner).first();
  await expect(badge).toBeVisible();
  const frame = await frameWindow(owner);
  const iframe = owner.locator('iframe[title^="Prototype"]');
  const container = owner.getByTestId('viewer-container');

  // 1. iframe 高度 = 裝置高度下量到的整頁高度
  await expect
    .poll(async () => {
      const m = await canvasMetrics(owner);
      const h = (await iframe.boundingBox())!.height / m.scale;
      const docH = await frame.evaluate(() => document.documentElement.scrollHeight);
      return Math.abs(h - docH);
    })
    .toBeLessThanOrEqual(2);

  // 2. 預設符合畫面：畫布不需要捲動
  const noScroll = async () =>
    expect
      .poll(async () => container.evaluate((el) => el.scrollHeight <= el.clientHeight + 1))
      .toBe(true);
  await noScroll();

  // 3. badge 中心貼齊形狀右上角
  const gap = async () => {
    const b = (await badge.boundingBox())!;
    const r = (await owner.locator('[data-shape-kind=rect] rect').first().boundingBox())!;
    return Math.max(
      Math.abs(b.x + b.width / 2 - (r.x + r.width)),
      Math.abs(b.y + b.height / 2 - r.y),
    );
  };
  await expect.poll(gap).toBeLessThanOrEqual(3);

  // 4. 放大後仍然貼齊
  const before = (await canvasMetrics(owner)).scale;
  await owner.keyboard.press('=');
  await owner.keyboard.press('=');
  await expect.poll(async () => (await canvasMetrics(owner)).scale).toBeGreaterThan(before);
  await expect(owner.getByRole('button', { name: '符合畫面（0）' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect.poll(gap).toBeLessThanOrEqual(3);

  // 5. 0 回到符合畫面
  await owner.keyboard.press('0');
  await expect(owner.getByRole('button', { name: '符合畫面（0）' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await noScroll();
  await expect.poll(gap).toBeLessThanOrEqual(3);
});

test('全畫面模式：F 隱藏頂列與工具列，浮動工具列可離開', async () => {
  const pageSelect = owner.getByRole('combobox', { name: '頁面' });
  await expect(pageSelect).toBeVisible();
  await owner.keyboard.press('f');
  await expect(pageSelect).toHaveCount(0);
  await expect(owner.getByRole('toolbar', { name: '全畫面工具列' })).toBeVisible();
  const box = await owner.getByTestId('viewer-container').boundingBox();
  expect(box!.y).toBe(0);
  await owner.getByRole('button', { name: '離開全畫面（F）' }).click();
  await expect(pageSelect).toBeVisible();
});

test('RWD：切到 768 時標記隱藏並出現「1440px（1）」chip；點 chip 回到 1440', async () => {
  await owner.getByRole('button', { name: 'Tablet 768' }).click();
  await expect(owner.getByRole('button', { name: 'Tablet 768' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(badges(owner)).toHaveCount(0);
  await expect(owner.locator('[data-testid="markup-svg"] [data-shape-kind]')).toHaveCount(0);
  const chip = owner.getByRole('button', { name: '1440px（1）' });
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(owner.getByRole('button', { name: 'Desktop 1440' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(badges(owner)).toHaveCount(1);
  await expect(owner.locator('[data-testid="markup-svg"] [data-shape-kind="rect"]')).toHaveCount(1);
});

test('換頁：pricing.html 沒有標記；回到 index.html 標記還在', async () => {
  const select = owner.getByRole('combobox', { name: '頁面' });
  await select.selectOption('pricing.html');
  await expect(select).toHaveValue('pricing.html');
  await expect(owner.getByTestId('markup-canvas')).toBeVisible();
  await expect(badges(owner)).toHaveCount(0);
  await expect(owner.locator('[data-testid="markup-svg"] [data-shape-kind]')).toHaveCount(0);
  await select.selectOption('index.html');
  await expect(select).toHaveValue('index.html');
  await expect(badges(owner)).toHaveCount(1);
});

test('擁有者建立分享連結（commenter），訪客畫箭頭並附說明', async ({ browser }) => {
  const res = await owner.request.post(`${ORIGINS.api}/projects/${projectId}/share-links`, {
    data: { role: 'commenter' },
  });
  expect(res.status()).toBeLessThan(300);
  const link = (await res.json()) as { token: string; url: string };
  shareToken = link.token;
  shareUrl = link.url;
  expect(shareUrl).toBe(`${ORIGINS.web}/s/${shareToken}`);

  const guestCtx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const guest = await guestCtx.newPage();
  guest.on('dialog', (d) => {
    throw new Error(`unexpected native dialog: ${d.message()}`);
  });
  await guest.goto(shareUrl);
  await guest.getByLabel('你的名字').fill('Guest Gina');
  await guest.getByRole('button', { name: '開始留言' }).click();
  await waitForViewerReady(guest);
  await expect(badges(guest)).toHaveCount(1); // 擁有者的標記可見

  await enterMarkupMode(guest);
  await guest.getByRole('button', { name: /^箭頭（A）/ }).click();
  await dragOnCanvas(guest, { x: 600, y: 200 }, { x: 420, y: 140 });
  const card = guest.getByTestId('thread-popover');
  await expect(card).toBeVisible();
  await expect(card.locator('textarea')).toBeFocused();
  await card
    .locator('textarea')
    .fill(
      '=HYPERLINK("https://evil.example","click") <script>alert(1)</script> [x](javascript:alert(1))',
    );
  await card.getByRole('button', { name: '送出' }).click();
  await expect(card).toContainText('<script>alert(1)</script>');
  await expect(badges(guest)).toHaveCount(2);
  // 即時同步：擁有者不重新整理就看到 #2
  await expect(badges(owner)).toHaveCount(2);
  await expect(badges(owner).filter({ hasText: '2' })).toHaveCount(1);
  await guestCtx.close();

  const list = await owner.request.get(`${ORIGINS.api}/versions/${versionId}/threads`);
  const threads = (
    (await list.json()) as {
      threads: {
        number: number | null;
        markup: { shape: { kind: string } };
        createdBy: { kind: string; name: string };
      }[];
    }
  ).threads;
  expect(threads.map((t) => t.markup.shape.kind).sort()).toEqual(['arrow', 'rect']);
  expect(threads.map((t) => t.number).sort()).toEqual([1, 2]);
  expect(threads.filter((t) => t.createdBy.kind === 'guest').map((t) => t.createdBy.name)).toEqual([
    'Guest Gina',
  ]);
});

test('擁有者回覆並標記已解決；已解決預設隱藏、可切換顯示', async () => {
  await expect(badges(owner)).toHaveCount(2);
  const second = badges(owner).filter({ hasText: '2' });
  await expect(second).toHaveCount(1);
  await second.click();
  const card = owner.getByTestId('thread-popover');
  await expect(card).toContainText('Guest Gina');
  // 惡意內容只會以純文字顯示
  await expect(card).toContainText('<script>alert(1)</script>');
  await card.locator('textarea').fill('已收到，會修正。');
  await card.getByRole('button', { name: '回覆' }).click();
  await expect(card).toContainText('已收到，會修正。');
  await card.getByRole('button', { name: '標記為已解決' }).click();
  // 開著的卡片不會因為標記解決而消失（按鈕變成「重新開啟」）；關閉後已解決的標記才依預設隱藏
  await expect(card.getByRole('button', { name: '重新開啟' })).toBeVisible();
  await owner.keyboard.press('Escape');
  await expect(badges(owner)).toHaveCount(1);

  await owner.getByRole('button', { name: '顯示已解決' }).click();
  await expect(badges(owner)).toHaveCount(2);
  await owner.getByRole('button', { name: '顯示已解決' }).click();
  await expect(badges(owner)).toHaveCount(1);

  // 標記面板：預設收合，開啟後列出附說明的標記（面板依「顯示已解決」過濾）
  await owner.getByRole('button', { name: /^標記面板/ }).click();
  const panel = owner.getByTestId('markup-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('#1');
  await owner.getByRole('button', { name: '顯示已解決' }).click();
  await expect(panel).toContainText('Guest Gina');
});

test('即時協作：兩個 context 互相看到頭像與游標', async ({ browser }) => {
  const guestCtx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const guest = await guestCtx.newPage();
  await guest.goto(shareUrl);
  await guest.getByLabel('你的名字').fill('Live Larry');
  await guest.getByRole('button', { name: '開始留言' }).click();
  await waitForViewerReady(guest);

  // 線上名單：雙方都看得到對方的頭像
  const ownerGroup = owner.getByRole('group', { name: '線上成員' });
  const guestGroup = guest.getByRole('group', { name: '線上成員' });
  await expect(ownerGroup.getByRole('img', { name: /Live Larry/ })).toBeVisible();
  await expect(guestGroup.getByRole('img')).toHaveCount(1);

  // 游標：訪客在 prototype 上移動滑鼠，擁有者看到帶名字的游標
  const box = (await guest.locator('iframe[title^="Prototype"]').boundingBox())!;
  for (let i = 1; i <= 8; i++) {
    await guest.mouse.move(box.x + 100 + i * 20, box.y + 150 + i * 10);
  }
  const cursor = owner.locator('[data-testid="live-cursor"][data-peer-name="Live Larry"]');
  await expect(cursor).toBeVisible();

  // 訪客切到 Tablet 768：游標消失（寬度不同），頭像標示 768px
  await guest.getByRole('button', { name: 'Tablet 768' }).click();
  await expect(cursor).toHaveCount(0);
  await expect(ownerGroup.getByRole('img', { name: /768px/ })).toBeVisible();

  await guestCtx.close();
  await expect(ownerGroup.getByRole('img', { name: /Live Larry/ })).toHaveCount(0);
});

test('匯出 JSON／Markdown／單檔 HTML', async () => {
  const get = async (format: string, req: APIRequestContext = owner.request) => {
    const r = await req.get(`${ORIGINS.api}/versions/${versionId}/export/${format}`);
    expect(r.status(), `${format} export`).toBe(200);
    return r;
  };

  const json = JSON.parse(await (await get('json')).text()) as {
    items: unknown[];
    $schema: string;
    schemaVersion: number;
  };
  expect(json.schemaVersion).toBe(2);
  expect(json.items).toHaveLength(2);
  expect(json.$schema).toMatch(/^https?:\/\//);

  const md = await (await get('markdown')).text();
  expect(md).toContain('### #1');
  expect(md).not.toMatch(/^<script/m);
  expect(md).not.toContain('](javascript:');

  const html = await (await get('html')).text();
  expect(html).toContain('id="hpe-data"');
  expect(html).not.toContain('</script><script>alert(2)');
  const payload = html.match(/<script type="application\/json" id="hpe-data">([\s\S]*?)<\/script>/);
  expect(payload).not.toBeNull();
  const parsed = JSON.parse(payload![1]!) as { annotations: { items: unknown[] } };
  expect(parsed.annotations.items).toHaveLength(2);
});

test('撤銷分享連結後訪客存取被拒絕（V23 API 一半）', async ({ browser }) => {
  const links = (await (
    await owner.request.get(`${ORIGINS.api}/projects/${projectId}/share-links`)
  ).json()) as {
    links: { id: string }[];
  };
  const revoke = await owner.request.delete(`${ORIGINS.api}/share-links/${links.links[0]!.id}`);
  expect(revoke.status()).toBeLessThan(300);

  const anon = await browser.newContext();
  const res = await anon.request.get(`${ORIGINS.api}/share/${shareToken}`);
  expect(res.status()).toBe(403);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe('SHARE_REVOKED');
  const threads = await anon.request.get(`${ORIGINS.api}/versions/${versionId}/threads`, {
    headers: { 'x-share-token': shareToken },
  });
  expect(threads.status()).toBe(403);
  await anon.close();
});

test('輪替 contentKey 後舊的 content URL 立即 404（V23 content 一半）', async () => {
  const before = (await (
    await owner.request.get(`${ORIGINS.api}/versions/${versionId}`)
  ).json()) as {
    version: { contentKey: string };
  };
  const oldUrl = `http://${before.version.contentKey}.${ORIGINS.contentBase}/index.html`;
  expect((await owner.request.get(oldUrl)).status()).toBe(200);
  const rot = await owner.request.post(`${ORIGINS.api}/versions/${versionId}/rotate-content-key`);
  expect(rot.status()).toBeLessThan(300);
  expect((await owner.request.get(oldUrl)).status()).toBe(404);
  // 新的 key 正常
  const after = (await (
    await owner.request.get(`${ORIGINS.api}/versions/${versionId}`)
  ).json()) as {
    version: { contentKey: string };
  };
  expect(after.version.contentKey).not.toBe(before.version.contentKey);
  const res = await owner.request.get(
    `http://${after.version.contentKey}.${ORIGINS.contentBase}/index.html`,
  );
  expect(res.status()).toBe(200);
  expect(res.headers()['content-security-policy']).toContain('sandbox allow-scripts');
  const html = await res.text();
  expect(html.indexOf('/__hpe/agent.v1.js')).toBeGreaterThan(-1);
});
