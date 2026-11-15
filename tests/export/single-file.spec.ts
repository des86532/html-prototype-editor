import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { Markup, Thread } from '@hpe/shared';
import {
  buildAnnotationsDocument,
  buildSingleFileHtml,
  extractPayload,
  inlineAssets,
  type Bundle,
} from '../../packages/exporter/src/index';
import { makeMarkup, makeVersion } from '../../packages/exporter/src/fixtures';

const ROOT = resolve(import.meta.dirname, '../..');
const SHELL = join(ROOT, 'packages/export-viewer/dist/index.html');
const AGENT = join(ROOT, 'packages/frame-agent/dist/agent.v1.js');
const PROTO = join(ROOT, 'tests/e2e/fixtures/proto');
const HOSTILE = join(ROOT, 'tests/export/fixtures/hostile.html');

const BUILD_HINT =
  'Run first: pnpm --filter @hpe/frame-agent build && pnpm --filter @hpe/export-viewer build';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const alice = { kind: 'user', userId: 'u1', name: 'Alice' } as const;
const bob = { kind: 'guest', guestId: 'g1', name: 'Bob' } as const;
const c = (threadId: string, n: number, author: Thread['createdBy'], body: string) => ({
  id: `${threadId}c${n}`,
  threadId,
  author,
  body,
  createdAt: '2026-02-01T10:00:00.000Z',
});

const HOSTILE_BODIES = [
  '<script>alert(1)</script>',
  '[x](javascript:alert(1))',
  '</script><script>window.__pwned=1</script>',
];

function thread(
  id: string,
  number: number | null,
  markup: Markup,
  over: Partial<Thread> = {},
): Thread {
  return {
    id,
    versionId: 'v1',
    number,
    markup,
    status: 'open',
    rev: 1,
    createdBy: alice,
    createdAt: '2026-02-01T10:00:00.000Z',
    comments: number === null ? [] : [c(id, 1, alice, `body of ${id}`)],
    ...over,
  };
}

/** t1 在 index.html、1440 寬度的位置；SVG 位置斷言用它。 */
const T1_RECT = { x: 100, y: 300, w: 220, h: 80 } as const;
const T1_STROKE = 4;
const DESKTOP_W = 1440;

const THREADS: Thread[] = [
  thread(
    't1',
    1,
    makeMarkup({ shape: { kind: 'rect', ...T1_RECT, color: '#e5484d', stroke: T1_STROKE } }),
    { comments: HOSTILE_BODIES.map((b, i) => c('t1', i + 1, i === 1 ? bob : alice, b)) },
  ),
  thread(
    't2',
    2,
    makeMarkup({
      shape: {
        kind: 'arrow',
        from: { x: 600, y: 200 },
        to: { x: 420, y: 140 },
        color: '#0091ff',
        stroke: 4,
      },
    }),
    {
      status: 'resolved',
      resolvedAt: '2026-02-02T00:00:00.000Z',
      createdBy: bob,
      comments: [c('t2', 1, bob, 'resolved arrow note')],
    },
  ),
  thread(
    't3',
    3,
    makeMarkup({
      shape: { kind: 'text', x: 60, y: 80, text: '改標題', color: '#24211c', stroke: 4 },
    }),
    { comments: [c('t3', 1, alice, 'text note')] },
  ),
  thread(
    't4',
    4,
    makeMarkup({
      pageId: 'pricing.html',
      shape: { kind: 'rect', x: 40, y: 120, w: 160, h: 60, color: '#30a46c', stroke: 2 },
    }),
    { createdBy: bob, comments: [c('t4', 1, bob, 'pricing note')] },
  ),
  thread(
    't5',
    5,
    makeMarkup({
      viewport: { width: 768, height: 1024 },
      shape: { kind: 'rect', x: 20, y: 200, w: 120, h: 60, color: '#f76b15', stroke: 4 },
    }),
    { comments: [c('t5', 1, alice, 'tablet note')] },
  ),
  // 沒有說明的標記：只畫在畫布上，沒有 badge、也不進面板
  thread(
    't6',
    null,
    makeMarkup({
      shape: {
        kind: 'highlighter',
        points: [
          [50, 500],
          [300, 500],
        ],
        color: '#ffb224',
        stroke: 4,
      },
    }),
  ),
];

let filePath = '';
let evil: Server;
let evilUrl = '';
const evilHits: string[] = [];

test.beforeAll(async () => {
  for (const f of [SHELL, AGENT]) {
    if (!existsSync(f)) throw new Error(`missing ${relative(ROOT, f)}. ${BUILD_HINT}`);
  }
  evil = createServer((req, res) => {
    evilHits.push(req.url ?? '');
    res.setHeader('access-control-allow-origin', '*');
    res.end('evil');
  });
  await new Promise<void>((ok) => evil.listen(0, '127.0.0.1', ok));
  evilUrl = `http://evil.localhost:${(evil.address() as AddressInfo).port}/steal`;

  const bundle = new Map<string, { data: Uint8Array }>();
  for (const f of walk(PROTO))
    bundle.set(relative(PROTO, f).split('\\').join('/'), { data: readFileSync(f) });
  const hostile = readFileSync(HOSTILE, 'utf8').replace(
    /window\.__EVIL_URL__ \|\| '[^']*'/,
    JSON.stringify(evilUrl),
  );
  bundle.set('hostile.html', { data: Buffer.from(hostile) });
  // 讓 pricing.html 可以連到 hostile 頁
  const pricing = Buffer.from(bundle.get('pricing.html')!.data)
    .toString('utf8')
    .replace('</main>', '<a id="to-hostile" href="hostile.html">Hostile</a></main>');
  bundle.set('pricing.html', { data: Buffer.from(pricing) });

  const { pages, report } = inlineAssets({ bundle: bundle as Bundle });
  expect(report.unresolved).toEqual([]);

  const version = makeVersion({
    entryPage: 'index.html',
    pages: [
      { path: 'index.html', title: 'Home' },
      { path: 'pricing.html', title: 'Pricing' },
      { path: 'hostile.html', title: 'Hostile' },
    ],
  });
  const annotations = buildAnnotationsDocument({
    project: { id: 'p1', name: 'Export <b>E2E</b>' },
    version,
    threads: THREADS,
    now: new Date('2026-03-01T00:00:00Z'),
  });
  const built = buildSingleFileHtml({
    shellHtml: readFileSync(SHELL, 'utf8'),
    annotations,
    pages,
    agentSource: readFileSync(AGENT, 'utf8'),
    meta: {
      projectName: 'Export <b>E2E</b>',
      versionNumber: 3,
      entryPage: 'index.html',
      exportedAt: annotations.exportedAt,
    },
  });
  filePath = join(mkdtempSync(join(tmpdir(), 'hpe-export-')), 'review.html');
  writeFileSync(filePath, built.html);
  test.info().annotations.push({ type: 'size', description: `${built.bytes} bytes` });
});

test.afterAll(async () => {
  await new Promise((ok) => evil.close(ok));
});

const frame = (page: Page) => page.frameLocator('iframe[title^="Prototype"]');
const badges = (page: Page) => page.locator('button[data-markup-id]');
const shapes = (page: Page) => page.locator('[data-testid="markup-svg"] [data-shape-kind]');

async function openFile(page: Page) {
  const requests: string[] = [];
  const dialogs: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  await page.goto(`file://${filePath}`);
  await expect(frame(page).locator('#cta')).toBeVisible();
  return { requests, dialogs };
}

test('markups: resolved hidden by default, shown on toggle; unnumbered markup has no badge', async ({
  page,
}) => {
  await openFile(page);
  // t1、t3 有 badge；t6（螢光筆、沒有說明）只有形狀。t2 已解決、t5 在其他寬度、t4 在其他頁面
  await expect(badges(page)).toHaveCount(2);
  await expect(shapes(page)).toHaveCount(3);
  await expect(page.locator('[data-markup-id="t6"]')).toHaveCount(0);
  await page.getByRole('button', { name: '顯示已解決' }).click();
  await expect(badges(page)).toHaveCount(3);
  await expect(shapes(page)).toHaveCount(4);
  await expect(page.locator('button[data-markup-id="t2"]')).toHaveCount(1);
  await page.getByRole('button', { name: '顯示已解決' }).click();
  await expect(badges(page)).toHaveCount(2);
  // 顯示標記 toggle + Shift+C
  await page.keyboard.press('Shift+C');
  await expect(badges(page)).toHaveCount(0);
  await expect(shapes(page)).toHaveCount(0);
  await page.keyboard.press('Shift+C');
  await expect(badges(page)).toHaveCount(2);
  await expect(page.getByRole('button', { name: /^標記（C）|Comment/ })).toHaveCount(0);
});

test('rect markup SVG lands at (x, y) * scale inside the frame (±2px)', async ({ page }) => {
  await openFile(page);
  await expect(shapes(page)).toHaveCount(3);
  const canvas = (await page.getByTestId('markup-canvas').boundingBox())!;
  const iframe = (await page.locator('iframe[title^="Prototype"]').boundingBox())!;
  const scale = canvas.width / DESKTOP_W;
  // 畫布與 iframe 重疊
  expect(Math.abs(canvas.x - iframe.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(canvas.y - iframe.y)).toBeLessThanOrEqual(2);
  const rect = (await page
    .locator('[data-testid="markup-svg"] [data-shape-kind="rect"] rect')
    .first()
    .boundingBox())!;
  // SVG 的 boundingBox 含線寬：比對中心點，尺寸則加上線寬（T1_STROKE）
  const cx = iframe.x + (T1_RECT.x + T1_RECT.w / 2) * scale;
  const cy = iframe.y + (T1_RECT.y + T1_RECT.h / 2) * scale;
  expect(Math.abs(rect.x + rect.width / 2 - cx)).toBeLessThanOrEqual(2);
  expect(Math.abs(rect.y + rect.height / 2 - cy)).toBeLessThanOrEqual(2);
  expect(Math.abs(rect.width - (T1_RECT.w + T1_STROKE) * scale)).toBeLessThanOrEqual(2);
  expect(Math.abs(rect.height - (T1_RECT.h + T1_STROKE) * scale)).toBeLessThanOrEqual(2);
});

test('clicking a badge opens a read-only card with the full discussion; Esc closes', async ({
  page,
}) => {
  const { dialogs } = await openFile(page);
  await expect(badges(page)).toHaveCount(2);
  await page.locator('button[data-markup-id="t1"]').click();
  const card = page.getByTestId('thread-popover');
  await expect(card).toBeVisible();
  await expect(card).toContainText('<script>alert(1)</script>');
  await expect(card).toContainText('javascript:alert(1)');
  await expect(card).toContainText('Bob');
  await expect(card).toContainText('window.__pwned=1');
  await expect(card.locator('textarea')).toHaveCount(0);
  await expect(card.getByRole('button', { name: /刪除標記/ })).toHaveCount(0);
  await expect(card.locator('a[href^="javascript:" i]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  expect(dialogs).toEqual([]);
  expect(
    await page.evaluate(() => (window as unknown as { __pwned?: unknown }).__pwned),
  ).toBeUndefined();
});

test('J/K navigate between numbered markups', async ({ page }) => {
  await openFile(page);
  await expect(badges(page)).toHaveCount(2);
  await page.keyboard.press('j');
  await expect(page.getByTestId('thread-popover')).toContainText('<script>alert(1)</script>');
  await page.keyboard.press('j');
  await expect(page.getByTestId('thread-popover')).toContainText('text note');
});

test('markup panel lists numbered markups of all pages; chip switches to the other width', async ({
  page,
}) => {
  await openFile(page);
  await expect(badges(page)).toHaveCount(2);
  await page.getByRole('button', { name: /標記面板/ }).click();
  const panel = page.getByTestId('markup-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('text note');
  await expect(panel).toContainText('pricing note');
  await expect(panel).toContainText('tablet note');
  // 已解決預設不列出；沒有說明的標記不在面板
  await expect(panel).not.toContainText('resolved arrow note');
  await expect(panel.locator('[data-panel-row]')).toHaveCount(4);
  await page.getByRole('button', { name: '顯示已解決' }).click();
  await expect(panel).toContainText('resolved arrow note');
  await page.getByRole('button', { name: '顯示已解決' }).click();

  // 其他寬度的標記：chip 提示，點了切到 768
  const chip = page.getByRole('button', { name: '768px（1）' });
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(page.getByRole('button', { name: 'Tablet 768' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('button[data-markup-id="t5"]')).toHaveCount(1);
  await expect(page.locator('button[data-markup-id="t1"]')).toHaveCount(0);
});

test("multi-page navigation swaps srcdoc and shows that page's markups", async ({ page }) => {
  await openFile(page);
  await expect(badges(page)).toHaveCount(2);
  await frame(page).locator('#nav-pricing').click();
  await expect(frame(page).locator('#buy')).toBeVisible();
  await expect(page.locator('button[data-markup-id="t4"]')).toHaveCount(1);
  await expect(badges(page)).toHaveCount(1);
  await expect(page.getByLabel('頁面').first()).toHaveValue('pricing.html');
  await frame(page).locator('a.logo').click();
  await expect(frame(page).locator('#cta')).toBeVisible();
  await expect(badges(page)).toHaveCount(2);
});

test('panel selection across pages switches page and opens the card', async ({ page }) => {
  await openFile(page);
  await page.getByRole('button', { name: /標記面板/ }).click();
  await page.getByTestId('markup-panel').getByText('pricing note').click();
  await expect(frame(page).locator('#buy')).toBeVisible();
  await expect(page.getByTestId('thread-popover')).toContainText('pricing note');
});

test('zero network requests; prototype fetch to evil is blocked (V22)', async ({ page }) => {
  const { requests } = await openFile(page);
  await frame(page).locator('#nav-pricing').click();
  await frame(page).locator('#to-hostile').click();
  await expect(frame(page).locator('body[data-fetch]')).toHaveAttribute('data-fetch', 'blocked');
  for (const url of requests) expect(url).toMatch(/^(data:|file:|about:|blob:)/);
  expect(evilHits).toEqual([]);
});

test('hostile content keeps the file intact and executes nothing (V19/V21)', async ({ page }) => {
  const html = readFileSync(filePath, 'utf8');
  const payload = extractPayload(html);
  expect(
    payload.annotations.items.find((i) => i['x-hpe:threadId'] === 't1')!.body.map((b) => b.value),
  ).toEqual(HOSTILE_BODIES);
  expect(payload.pages['hostile.html']).toContain('<\\/script><script>window.__pwned');
  const dataBlock = /id="hpe-data">([\s\S]*?)<\/script>/.exec(html)![1]!;
  expect(dataBlock).not.toMatch(/[<>&\u2028\u2029]/);

  const { dialogs } = await openFile(page);
  await frame(page).locator('#nav-pricing').click();
  await frame(page).locator('#to-hostile').click();
  const body = frame(page).locator('body[data-hostile-ok]');
  await expect(body).toHaveAttribute('data-hostile-ok', /^\d+$/);
  await expect(frame(page).locator('#payload-text')).toContainText('window.__pwned=1');
  expect(
    await frame(page)
      .locator('body')
      .evaluate(() => (window as unknown as { __pwned?: unknown }).__pwned),
  ).toBeUndefined();
  expect(
    await page.evaluate(() => (window as unknown as { __pwned?: unknown }).__pwned),
  ).toBeUndefined();
  expect(dialogs).toEqual([]);
  await expect(page.locator('h1')).toContainText('Export <b>E2E</b>');
  await expect(page.locator('h1 b')).toHaveCount(0);
});

test('shell is stand-alone safe: exactly one CSP meta and the sandbox attributes are fixed', async ({
  page,
}) => {
  await openFile(page);
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1);
  const iframe = page.locator('iframe[title^="Prototype"]');
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer');
  expect(await iframe.getAttribute('src')).toBeNull();
});
