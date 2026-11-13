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
import type { Anchor, Thread } from '@hpe/shared';
import {
  buildAnnotationsDocument,
  buildSingleFileHtml,
  extractPayload,
  inlineAssets,
  type Bundle,
} from '../../packages/exporter/src/index';
import { makeVersion } from '../../packages/exporter/src/fixtures';

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
const fingerprint = { tag: 'x', classes: [], textHash: 'h', siblingIndex: 0, depth: 1 };

function anchor(
  pageId: string,
  over: Partial<Anchor['selectors']>,
  kind: Anchor['kind'],
  extra: Partial<Anchor> = {},
): Anchor {
  return {
    pageId,
    kind,
    viewport: { width: 1440, height: 900, dpr: 1, preset: 'desktop' },
    selectors: { fingerprint, elementOffset: { x: 0.5, y: 0.5 }, ...over },
    fallback: { x: 100, y: 100, w: 50, h: 30 },
    snapshot: { tag: 'div', text: '' },
    ...extra,
  };
}

const da = (value: string) => ({ name: 'data-comment-anchor', value });

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

function thread(id: string, number: number, a: Anchor, over: Partial<Thread> = {}): Thread {
  return {
    id,
    versionId: 'v1',
    number,
    anchor: a,
    status: 'open',
    tags: [],
    createdBy: alice,
    createdAt: '2026-02-01T10:00:00.000Z',
    comments: [c(id, 1, alice, `body of ${id}`)],
    ...over,
  };
}

const THREADS: Thread[] = [
  thread(
    't1',
    1,
    anchor('index.html', { css: '#cta', dataAttr: da('cta') }, 'element', {
      snapshot: { tag: 'button', text: 'Get started' },
    }),
    {
      tags: ['bug'],
      comments: HOSTILE_BODIES.map((b, i) => c('t1', i + 1, i === 1 ? bob : alice, b)),
    },
  ),
  thread(
    't2',
    2,
    anchor(
      'index.html',
      { css: 'section.hero', dataAttr: da('hero'), regionSize: { w: 0.5, h: 0.5 } },
      'region',
    ),
    {
      status: 'resolved',
      resolvedAt: '2026-02-02T00:00:00.000Z',
      createdBy: bob,
      comments: [c('t2', 1, bob, 'resolved region note')],
    },
  ),
  thread(
    't3',
    3,
    anchor(
      'index.html',
      {
        css: '#lede',
        textQuote: { exact: 'quickest way to ship', prefix: 'The ', suffix: ' a prototype' },
      },
      'text',
    ),
    { tags: ['copy'], comments: [c('t3', 1, alice, 'text note')] },
  ),
  thread('t4', 4, anchor('pricing.html', { css: '#buy', dataAttr: da('buy') }, 'element'), {
    createdBy: bob,
    comments: [c('t4', 1, bob, 'pricing note')],
  }),
  thread(
    't5',
    5,
    anchor('index.html', { css: '#secret', dataAttr: da('secret') }, 'element', {
      stateHint: { inDialog: true },
    }),
    { comments: [c('t5', 1, alice, 'hidden state note')] },
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
  // 錨點用 data-comment-anchor 才會是 exact（fingerprint 不需要手算）。
  const edit = (path: string, pairs: [string, string][]) => {
    let text = Buffer.from(bundle.get(path)!.data).toString('utf8');
    for (const [from, to] of pairs) {
      expect(text).toContain(from);
      text = text.replace(from, to);
    }
    bundle.set(path, { data: Buffer.from(text) });
  };
  edit('index.html', [
    ['<button id="cta"', '<button data-comment-anchor="cta" id="cta"'],
    ['<section class="hero">', '<section class="hero" data-comment-anchor="hero">'],
    ['<p id="lede"', '<p data-comment-anchor="lede" id="lede"'],
    ['</main>', '<div id="secret" data-comment-anchor="secret" hidden>Secret dialog</div></main>'],
  ]);
  edit('pricing.html', [['<button id="buy"', '<button data-comment-anchor="buy" id="buy"']]);
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

test.beforeEach(({ browserName }) => {
  test.skip(browserName !== 'chromium', 'chromium only for now');
});

const frame = (page: Page) => page.frameLocator('iframe[title^="Prototype"]');
const pins = (page: Page) => page.locator('[data-pin-id]');

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

test('pins: resolved hidden by default, shown on toggle; hidden-state thread has no pin', async ({
  page,
}) => {
  await openFile(page);
  await expect(pins(page)).toHaveCount(2);
  await expect(page.locator('[data-pin-id="t1"]')).toHaveCount(1);
  await expect(page.locator('[data-pin-id="t3"]')).toHaveCount(1);
  await page.getByRole('button', { name: '顯示已解決' }).click();
  await expect(pins(page)).toHaveCount(3);
  await expect(page.locator('[data-pin-id="t2"]')).toHaveCount(1);
  await page.getByRole('button', { name: '顯示已解決' }).click();
  await expect(pins(page)).toHaveCount(2);
  // 顯示留言 toggle + Shift+C
  await page.keyboard.press('Shift+C');
  await expect(pins(page)).toHaveCount(0);
  await page.keyboard.press('Shift+C');
  await expect(pins(page)).toHaveCount(2);
  await expect(page.getByRole('button', { name: /新留言|Comment/ })).toHaveCount(0);
});

test('clicking a pin opens a read-only card with the full discussion; Esc closes', async ({
  page,
}) => {
  const { dialogs } = await openFile(page);
  await expect(pins(page)).toHaveCount(2);
  await page.locator('[data-pin-id="t1"] button').click();
  const card = page.getByTestId('thread-popover');
  await expect(card).toBeVisible();
  await expect(card).toContainText('<script>alert(1)</script>');
  await expect(card).toContainText('javascript:alert(1)');
  await expect(card).toContainText('Bob');
  await expect(card).toContainText('window.__pwned=1');
  await expect(card.locator('textarea')).toHaveCount(0);
  await expect(card.locator('a[href^="javascript:" i]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  expect(dialogs).toEqual([]);
  expect(
    await page.evaluate(() => (window as unknown as { __pwned?: unknown }).__pwned),
  ).toBeUndefined();
});

test('J/K navigate between pins', async ({ page }) => {
  await openFile(page);
  await expect(pins(page)).toHaveCount(2);
  await page.keyboard.press('j');
  await expect(page.getByTestId('thread-popover')).toContainText('<script>alert(1)</script>');
  await page.keyboard.press('j');
  await expect(page.getByTestId('thread-popover')).toContainText('text note');
});

test('comment panel lists everything, filters work, panel-only threads are reachable', async ({
  page,
}) => {
  await openFile(page);
  await expect(pins(page)).toHaveCount(2);
  await page.getByRole('button', { name: /留言面板/ }).click();
  const panel = page.getByTestId('comment-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('hidden state note');
  await expect(
    panel.locator('[data-testid="panel-group-hidden"], [data-testid="panel-group-orphaned"]'),
  ).toContainText('hidden state note');
  await expect(panel).toContainText('pricing note');
  await panel.getByLabel('狀態', { exact: true }).selectOption('resolved');
  await expect(panel).toContainText('resolved region note');
  await expect(panel).not.toContainText('text note');
  await panel.getByLabel('狀態', { exact: true }).selectOption('all');
  await panel.getByLabel('頁面', { exact: true }).selectOption('pricing.html');
  await expect(panel).toContainText('pricing note');
  await expect(panel).not.toContainText('text note');
  await panel.getByLabel('頁面', { exact: true }).selectOption('');
  await panel.getByLabel('標籤', { exact: true }).selectOption('copy');
  await expect(panel).toContainText('text note');
  await expect(panel).not.toContainText('pricing note');
});

test("multi-page navigation swaps srcdoc and shows that page's pins", async ({ page }) => {
  await openFile(page);
  await expect(pins(page)).toHaveCount(2);
  await frame(page).locator('#nav-pricing').click();
  await expect(frame(page).locator('#buy')).toBeVisible();
  await expect(page.locator('[data-pin-id="t4"]')).toHaveCount(1);
  await expect(pins(page)).toHaveCount(1);
  await expect(page.getByLabel('頁面').first()).toHaveValue('pricing.html');
  await frame(page).locator('a.logo').click();
  await expect(frame(page).locator('#cta')).toBeVisible();
  await expect(pins(page)).toHaveCount(2);
});

test('panel selection across pages switches page, opens the card', async ({ page }) => {
  await openFile(page);
  await page.getByRole('button', { name: /留言面板/ }).click();
  await page.getByTestId('comment-panel').getByText('pricing note').click();
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
