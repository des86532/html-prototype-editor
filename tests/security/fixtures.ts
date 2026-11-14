import { request as httpRequest } from 'node:http';
import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { contentUrl } from '../../packages/shared/src/index.js';
import {
  APP_ORIGIN,
  CANARY_COOKIE,
  CANARY_STORAGE_KEY,
  CANARY_STORAGE_VALUE,
  CONTENT_BASE_DOMAIN,
  CONTENT_PORT,
  TEST_KEY,
} from './config.js';
import { startServers, type EvilRequest, type Servers } from './servers.js';

export interface VectorResult {
  name: string;
  data: unknown;
}

export interface HarnessStats {
  counts: Record<string, number>;
  dropped: Record<string, number>;
  toasts: string[];
  toastsSuppressed: number;
  vector: VectorResult[];
  maxJitterMs: number;
}

const WATCHED_TAGS = [
  'script',
  'iframe',
  'img',
  'object',
  'embed',
  'form',
  'base',
  'link',
  'style',
  'a',
  'video',
  'audio',
  'meta',
];

/** harness DOM 的「元素指紋」：向量執行前後必須相同（沒有被注入任何元素）。 */
async function domFingerprint(page: Page): Promise<Record<string, number>> {
  return page.evaluate((tags) => {
    const out: Record<string, number> = {};
    for (const t of tags) out[t] = document.querySelectorAll(t).length;
    out['[on*]'] = document.querySelectorAll('[onerror],[onload],[onclick],[onfocus]').length;
    out['xss'] = (window as unknown as { __xss?: unknown }).__xss === undefined ? 0 : 1;
    return out;
  }, WATCHED_TAGS);
}

export interface Harness {
  page: Page;
  servers: Servers;
  /** 向量 URL（content server，真實 agent 注入） */
  vectorUrl(file: string, key?: string): string;
  /** 以 harness 載入向量；預設等到 watchdog 狀態為 ready。 */
  open(file: string, opts?: { waitReady?: boolean }): Promise<void>;
  /** evil server 收到的請求（排除 /__requests 自己） */
  evilRequests(): EvilRequest[];
  /** evil server 最多可以收到的請求數（預設 0；只有 V9 的殘餘風險是 1） */
  allowEvilRequests: number;
  stats(): Promise<HarnessStats>;
  /** 等向量回報 `name`（預設 done） */
  waitForVector(name?: string, timeoutMs?: number): Promise<void>;
  vectorData<T = Record<string, unknown>>(name: string): Promise<T[]>;
  status(): Promise<string>;
  dialogs: string[];
}

export const test = base.extend<{ harness: Harness }, { servers: Servers }>({
  servers: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const servers = await startServers();
      await use(servers);
      await servers.stop();
    },
    { scope: 'worker', auto: true, timeout: 180_000 },
  ],

  harness: async ({ page, context, servers }, use) => {
    const dialogs: string[] = [];
    page.on('dialog', (d) => {
      dialogs.push(`${d.type()}: ${d.message()}`);
      void d.dismiss();
    });
    servers.evil.reset();
    await page.goto(`${APP_ORIGIN}/harness.html`);
    await expect(page.getByTestId('harness-root')).toBeVisible();
    const baseline = await domFingerprint(page);

    const h: Harness = {
      page,
      servers,
      allowEvilRequests: 0,
      dialogs,
      vectorUrl: (file, key = TEST_KEY) => contentUrl(CONTENT_BASE_DOMAIN, key, file, 'http'),
      async open(file, opts = {}) {
        await page.goto(`${APP_ORIGIN}/harness.html?src=${encodeURIComponent(h.vectorUrl(file))}`);
        if (opts.waitReady !== false)
          await expect(page.getByTestId('status')).toHaveText('ready', { timeout: 15_000 });
      },
      evilRequests: () => servers.evil.requests(),
      stats: () =>
        page.evaluate(
          () => (window as unknown as { __harness: unknown }).__harness as HarnessStats,
        ),
      async waitForVector(name = 'done', timeoutMs = 15_000) {
        await expect
          .poll(async () => (await h.stats()).vector.some((v) => v.name === name), {
            timeout: timeoutMs,
          })
          .toBe(true);
      },
      async vectorData<T>(name: string) {
        return (await h.stats()).vector.filter((v) => v.name === name).map((v) => v.data as T);
      },
      status: () => page.getByTestId('status').innerText(),
    };
    const startUrl = `${APP_ORIGIN}/harness.html`;
    await use(h);

    // —— 每個向量共同的通過條件（規格 Verification 1）——
    await page.waitForTimeout(500); // 讓延遲的外送請求有機會出現
    const evil = servers.evil.requests();
    expect(
      evil.length,
      `evil server requests (max ${h.allowEvilRequests}): ${JSON.stringify(evil)}`,
    ).toBeLessThanOrEqual(h.allowEvilRequests);
    expect(dialogs, 'native dialogs').toEqual([]);
    expect(context.pages(), 'no popup windows').toHaveLength(1);
    expect(page.url().startsWith(startUrl), 'harness page was not navigated').toBe(true);
    const cookie = await page.evaluate(() => document.cookie);
    expect(cookie).toContain(CANARY_COOKIE);
    const stored = await page.evaluate((k) => localStorage.getItem(k), CANARY_STORAGE_KEY);
    expect(stored).toBe(CANARY_STORAGE_VALUE);
    const after = await domFingerprint(page);
    // iframe 可以因為 V10「停止 prototype」被移除，其他元素數量不可以變。
    const { iframe: afterIframes, ...restAfter } = after;
    const { iframe: baseIframes, ...restBase } = baseline;
    expect(restAfter, 'harness DOM was not modified').toEqual(restBase);
    expect(afterIframes ?? 0).toBeLessThanOrEqual((baseIframes ?? 0) + 1);
  },
});

export { expect };

/** 直接對 content server 發 HTTP 請求（以 Host header 選 contentKey，不依賴 *.localhost 的 DNS）。 */
export function contentGet(
  path: string,
  opts: { key?: string; host?: string; method?: string } = {},
): Promise<{
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}> {
  const host = opts.host ?? `${opts.key ?? TEST_KEY}.${CONTENT_BASE_DOMAIN}`;
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port: CONTENT_PORT,
        path,
        method: opts.method ?? 'GET',
        headers: { host },
      },
      (res) => {
        const parts: Buffer[] = [];
        res.on('data', (c: Buffer) => parts.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(parts).toString(),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

export type { BrowserContext, Page };
