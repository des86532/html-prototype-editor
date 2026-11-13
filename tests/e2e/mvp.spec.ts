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
  createProjectViaUi,
  enterCommentMode,
  frameWindow,
  login,
  pinPagePoint,
  viewerHandles,
  waitForViewerReady,
} from './helpers';

/**
 * 端到端流程（規格 Verification §2）：
 * 擁有者匯入多頁 zip → 安全報告 → Figma 式留言（草稿 pin、卡片、捲動、Esc） → RWD →
 * 分享連結 → 訪客留下元素／區域／文字評論 → 擁有者回覆並標記解決 → 匯出全部格式 → 撤銷分享。
 */
test.describe.configure({ mode: 'serial' });

const OWNER_EMAIL = `owner-${Date.now()}@example.com`;

let ownerContext: BrowserContext;
let owner: Page;
let projectId = '';
let versionId = '';
let shareToken = '';
let shareUrl = '';
const threadPosts: string[] = [];

test.beforeAll(async ({ browser }) => {
  ownerContext = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  owner = await ownerContext.newPage();
  owner.on('request', (req) => {
    if (req.method() === 'POST' && /\/versions\/[^/]+\/threads$/.test(req.url())) {
      threadPosts.push(req.url());
    }
  });
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

async function pinCount(page: Page): Promise<number> {
  return page.locator('[data-pin-id]:not([data-testid="pin-draft"])').count();
}

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

test('Figma 式留言：草稿 pin 在點擊處、卡片同時開啟、送出轉正式', async () => {
  await openViewer(owner, `${ORIGINS.web}/p/${projectId}/v/1`);
  const { frame } = viewerHandles(owner);

  const cta = await frame.locator('#cta').boundingBox();
  expect(cta).not.toBeNull();
  const click = { x: cta!.x + cta!.width / 2, y: cta!.y + cta!.height / 2 };
  await enterCommentMode(owner, click);
  await owner.mouse.click(click.x, click.y);

  // 草稿 pin 出現在點擊座標 ±2px
  const draft = owner.getByTestId('pin-draft');
  await expect(draft).toBeVisible();
  const draftPoint = await pinPagePoint(owner, 'pin-draft');
  expect(Math.abs(draftPoint.x - click.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(draftPoint.y - click.y)).toBeLessThanOrEqual(2);

  // 卡片同時開啟，輸入框取得焦點
  const card = owner.getByTestId('thread-popover');
  await expect(card).toBeVisible();
  const input = card.locator('textarea');
  await expect(input).toBeFocused();

  // Esc 捨棄空草稿：API 沒有收到任何 POST
  threadPosts.length = 0;
  await owner.keyboard.press('Escape');
  await expect(owner.getByTestId('pin-draft')).toHaveCount(0);
  await expect(card).toHaveCount(0);
  expect(threadPosts).toHaveLength(0);

  // 再點一次，送出留言
  await owner.mouse.click(click.x, click.y);
  await owner
    .getByTestId('thread-popover')
    .locator('textarea')
    .fill('按鈕文案太平淡，建議改成「立即開始」。');
  await owner.getByTestId('thread-popover').getByRole('button', { name: '送出' }).click();
  await expect(owner.getByTestId('pin-draft')).toHaveCount(0);
  await expect.poll(() => pinCount(owner)).toBe(1);
  expect(threadPosts).toHaveLength(1);
  // 卡片保持開啟並顯示第一則留言
  await expect(owner.getByTestId('thread-popover')).toContainText('按鈕文案太平淡');
  await expect(owner.getByRole('button', { name: /^評論 #1/ })).toBeVisible();
});

test('捲動 prototype 後卡片與 pin 相對位置不變；pin 捲出可視區時卡片隱藏、邊緣箭頭出現', async () => {
  const pinId = (await owner
    .locator('[data-pin-id]:not([data-testid="pin-draft"])')
    .first()
    .getAttribute('data-pin-id'))!;
  const card = owner.getByTestId('thread-popover');
  await expect(card).toBeVisible();
  const frame = await frameWindow(owner);

  const rel = async () => {
    const p = await pinPagePoint(owner, `pin-${pinId}`);
    const c = (await card.boundingBox())!;
    return { dx: c.x - p.x, dy: c.y - p.y, py: p.y };
  };
  const before = await rel();
  await frame.evaluate(() => window.scrollTo(0, 80));
  await expect.poll(async () => Math.round((await rel()).py)).not.toBe(Math.round(before.py));
  const after = await rel();
  expect(Math.abs(after.dx - before.dx)).toBeLessThanOrEqual(2);
  expect(Math.abs(after.dy - before.dy)).toBeLessThanOrEqual(2);

  await frame.evaluate(() => window.scrollTo(0, 1500));
  await expect(owner.getByTestId(`edge-${pinId}`)).toBeVisible();
  await expect(card).toBeHidden();

  // 點邊緣箭頭 → scrollToAnchor 並重新顯示卡片
  await owner.getByTestId(`edge-${pinId}`).click();
  await expect(card).toBeVisible();
  await frame.evaluate(() => window.scrollTo(0, 0));
  await owner.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
});

test('RWD：1440 / 768 / 390 三個寬度下 pin 錨點都落在目標元素 bbox 內', async () => {
  const pinId = (await owner
    .locator('[data-pin-id]:not([data-testid="pin-draft"])')
    .first()
    .getAttribute('data-pin-id'))!;
  const { frame } = viewerHandles(owner);
  for (const label of ['Desktop 1440', 'Tablet 768', 'Mobile 390']) {
    await owner.getByRole('button', { name: label }).click();
    await expect(owner.getByRole('button', { name: label })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(owner.getByTestId(`pin-${pinId}`)).toBeVisible();
    await expect
      .poll(async () => {
        const box = await frame.locator('#cta').boundingBox();
        const p = await pinPagePoint(owner, `pin-${pinId}`);
        if (!box) return 'no-box';
        const inside =
          p.x >= box.x - 1 &&
          p.x <= box.x + box.width + 1 &&
          p.y >= box.y - 1 &&
          p.y <= box.y + box.height + 1;
        return inside ? 'inside' : `outside ${JSON.stringify({ p, box })}`;
      })
      .toBe('inside');
  }
  await owner.getByRole('button', { name: 'Desktop 1440' }).click();
});

test('擁有者建立分享連結（commenter），訪客留下元素／區域／文字三種評論', async ({ browser }) => {
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
  await expect.poll(() => pinCount(guest)).toBe(1); // 擁有者的元素評論可見

  const { frame } = viewerHandles(guest);
  const title = (await frame.locator('h1').boundingBox())!;
  await enterCommentMode(guest, { x: title.x + 20, y: title.y + title.height / 2 });
  const submit = async (text: string) => {
    const card = guest.getByTestId('thread-popover');
    await expect(card).toBeVisible();
    await card.locator('textarea').fill(text);
    await card.getByRole('button', { name: '送出' }).click();
    await expect(guest.getByTestId('pin-draft')).toHaveCount(0);
    await guest.keyboard.press('Escape');
  };

  // 元素評論：點標題

  await guest.mouse.click(title.x + 20, title.y + title.height / 2);
  await submit('=HYPERLINK("https://evil.example","click") <script>alert(1)</script>');
  await expect.poll(() => pinCount(guest)).toBe(2);

  // 區域評論：在沒有文字的空白區拖曳（拖過文字會被視為文字選取，也就是文字評論）
  const spacer = (await frame.locator('.long > div').boundingBox())!;
  const rx = spacer.x + 100;
  const ry = spacer.y + 40;
  await guest.mouse.move(rx, ry);
  await guest.mouse.down();
  await guest.mouse.move(rx + 120, ry + 60, { steps: 8 });
  await guest.mouse.move(rx + 240, ry + 140, { steps: 8 });
  await guest.mouse.up();
  await submit('這個區塊留白過多。[x](javascript:alert(1))');
  await expect.poll(() => pinCount(guest)).toBe(3);
  await expect(guest.locator('[data-kind="region"]')).toHaveCount(1);

  // 文字評論：選取內文一段文字
  const lede = (await frame.locator('#lede').boundingBox())!;
  await guest.mouse.move(lede.x + 2, lede.y + 8);
  await guest.mouse.down();
  await guest.mouse.move(lede.x + 220, lede.y + 8, { steps: 10 });
  await guest.mouse.up();
  await submit('這句話可以更精簡。</script><script>alert(2)</script>');
  await expect.poll(() => pinCount(guest)).toBe(4);
  await expect(guest.locator('[data-kind="text"]')).toHaveCount(1);

  await guestCtx.close();

  const list = await owner.request.get(`${ORIGINS.api}/versions/${versionId}/threads`);
  const threads = (
    (await list.json()) as {
      threads: { anchor: { kind: string }; createdBy: { kind: string; name: string } }[];
    }
  ).threads;
  expect(threads.map((t) => t.anchor.kind).sort()).toEqual([
    'element',
    'element',
    'region',
    'text',
  ]);
  expect(threads.filter((t) => t.createdBy.kind === 'guest').map((t) => t.createdBy.name)).toEqual([
    'Guest Gina',
    'Guest Gina',
    'Guest Gina',
  ]);
});

test('擁有者回覆並標記解決；已解決的 pin 預設隱藏、可切換顯示', async () => {
  await openViewer(owner, `${ORIGINS.web}/p/${projectId}/v/1`);
  await expect.poll(() => pinCount(owner)).toBe(4);

  await owner.getByRole('button', { name: /^評論 #2/ }).click();
  const card = owner.getByTestId('thread-popover');
  await expect(card).toContainText('Guest Gina');
  // 惡意內容只會以純文字顯示
  await expect(card).toContainText('<script>alert(1)</script>');
  await card.locator('textarea').fill('已收到，會修正。');
  await card.getByRole('button', { name: '回覆' }).click();
  await expect(card).toContainText('已收到，會修正。');
  await card.getByRole('button', { name: 'Resolve' }).click();
  // 開著的卡片不會因為標記解決而消失（按鈕變成「重新開啟」）；關閉後已解決的 pin 才依預設隱藏
  await expect(card.getByRole('button', { name: '重新開啟' })).toBeVisible();
  await owner.keyboard.press('Escape');
  await expect.poll(() => pinCount(owner)).toBe(3);

  await owner.getByRole('button', { name: '顯示已解決' }).click();
  await expect.poll(() => pinCount(owner)).toBe(4);
  await owner.getByRole('button', { name: '顯示已解決' }).click();

  // 留言面板：預設收合，開啟後可篩選
  await owner.getByRole('button', { name: /^留言面板/ }).click();
  const panel = owner
    .getByRole('complementary', { name: '留言面板' })
    .or(owner.getByTestId('comment-panel'));
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Guest Gina');
});

test('匯出全部格式：JSON／Markdown／CSV／Review Package／單檔 HTML', async () => {
  const get = async (format: string, req: APIRequestContext = owner.request) => {
    const r = await req.get(`${ORIGINS.api}/versions/${versionId}/export/${format}`);
    expect(r.status(), `${format} export`).toBe(200);
    return r;
  };

  const json = JSON.parse(await (await get('json')).text()) as {
    items: unknown[];
    $schema: string;
  };
  expect(json.items).toHaveLength(4);
  expect(json.$schema).toMatch(/^https?:\/\//);

  const md = await (await get('markdown')).text();
  expect(md).toContain('#1');
  expect(md).not.toMatch(/^<script/m);
  expect(md).not.toContain('](javascript:');

  const csvRes = await get('csv');
  const csv = await csvRes.text();
  // V20：公式注入的儲存格開頭加上 '
  expect(csv).toMatch(/'=HYPERLINK/);
  expect(csv).not.toMatch(/(^|,|\n)"?=HYPERLINK/);

  const pkg = await (await get('package')).body();
  expect(pkg.subarray(0, 2).toString()).toBe('PK');

  const html = await (await get('html')).text();
  expect(html).toContain('id="hpe-data"');
  expect(html).not.toContain('</script><script>alert(2)');
  const payload = html.match(/<script type="application\/json" id="hpe-data">([\s\S]*?)<\/script>/);
  expect(payload).not.toBeNull();
  const parsed = JSON.parse(payload![1]!) as { annotations: { items: unknown[] } };
  expect(parsed.annotations.items).toHaveLength(4);
});

test('Review Package 匯出後匯入新專案，討論串內容與狀態完全一致', async () => {
  const pkg = await (
    await owner.request.get(`${ORIGINS.api}/versions/${versionId}/export/package`)
  ).body();
  const p2 = await owner.request.post(`${ORIGINS.api}/projects`, { data: { name: 'Round trip' } });
  const project2 = ((await p2.json()) as { project: { id: string } }).project.id;
  const imp = await owner.request.post(`${ORIGINS.api}/projects/${project2}/import-package`, {
    multipart: { file: { name: 'pkg.zip', mimeType: 'application/zip', buffer: pkg } },
  });
  expect(imp.status()).toBeLessThan(300);
  const v2 = ((await imp.json()) as { version: { id: string } }).version.id;

  type T = { status: string; tags: string[]; anchor: unknown; comments: { body: string }[] };
  const a = (
    (await (await owner.request.get(`${ORIGINS.api}/versions/${versionId}/threads`)).json()) as {
      threads: T[];
    }
  ).threads;
  const b = (
    (await (await owner.request.get(`${ORIGINS.api}/versions/${v2}/threads`)).json()) as {
      threads: T[];
    }
  ).threads;
  const norm = (ts: T[]) =>
    ts.map((t) => ({
      status: t.status,
      tags: t.tags,
      anchor: t.anchor,
      bodies: t.comments.map((c) => c.body),
    }));
  expect(norm(b)).toEqual(norm(a));
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
