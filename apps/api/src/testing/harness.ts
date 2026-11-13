import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Anchor, ThreadTag } from '@hpe/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../app.js';
import { DEFAULT_RATE_LIMITS, loadConfig, type Config } from '../config.js';
import type { Mailer } from '../mail.js';
import { FsStorage } from '../storage/fs.js';
import { createTestDb, type TestDb } from './db.js';
import { multipartBody } from './zip.js';

export class FakeMailer implements Mailer {
  sent: { email: string; link: string }[] = [];
  async sendMagicLink(email: string, link: string): Promise<void> {
    this.sent.push({ email, link });
  }
}

export interface Harness {
  app: FastifyInstance;
  testDb: TestDb;
  config: Config;
  mailer: FakeMailer;
  storage: FsStorage;
  storageRoot: string;
  /** 登入並回傳 cookie header 值（`hpe_session=…`） */
  login(email: string): Promise<string>;
  createProject(cookie: string, name?: string): Promise<{ id: string }>;
  uploadHtml(
    cookie: string,
    projectId: string,
    html?: string,
  ): Promise<{ id: string; contentKey: string }>;
  createShare(
    cookie: string,
    projectId: string,
    role?: 'commenter' | 'viewer',
    extra?: Record<string, unknown>,
  ): Promise<{ token: string; id: string }>;
  guest(token: string, name?: string, guestToken?: string): Promise<string>;
  close(): Promise<void>;
}

export interface HarnessOptions {
  config?: Partial<Config>;
  now?: () => Date;
}

export async function createHarness(opts: HarnessOptions = {}): Promise<Harness> {
  const testDb = await createTestDb();
  const storageRoot = await mkdtemp(path.join(tmpdir(), 'hpe-test-storage-'));
  const mailer = new FakeMailer();
  const storage = new FsStorage(storageRoot);
  const config: Config = {
    ...loadConfig({
      APP_ORIGIN: 'http://localhost:5173',
      API_ORIGIN: 'http://localhost:5175',
      SESSION_SECRET: 'test-session-secret-test-session-secret',
      DEV_MAGIC_LINK: 'true',
      INTERNAL_TOKEN: 'test-internal-token',
      STORAGE_FS_ROOT: storageRoot,
    }),
    // 預設放寬頻率限制，避免互相干擾；要測限流的測試自行覆寫
    rateLimits: Object.fromEntries(
      Object.keys(DEFAULT_RATE_LIMITS).map((k) => [
        k,
        { capacity: 10_000, refillPerSecond: 10_000 },
      ]),
    ) as unknown as Config['rateLimits'],
    ...opts.config,
  };
  const app = await buildApp({
    config,
    db: testDb.db,
    storage,
    mailer,
    ...(opts.now ? { now: opts.now } : {}),
  });
  await app.ready();

  const h: Harness = {
    app,
    testDb,
    config,
    mailer,
    storage,
    storageRoot,
    async login(email) {
      const res = await app.inject({ method: 'POST', url: '/auth/magic-link', payload: { email } });
      const devLink = (res.json() as { devLink: string }).devLink;
      const cb = await app.inject({
        method: 'GET',
        url: new URL(devLink).pathname + new URL(devLink).search,
      });
      return cookieOf(cb);
    },
    async createProject(cookie, name = '專案') {
      const res = await app.inject({
        method: 'POST',
        url: '/projects',
        headers: { cookie },
        payload: { name },
      });
      return (res.json() as { project: { id: string } }).project;
    },
    async uploadHtml(
      cookie,
      projectId,
      html = '<!doctype html><title>首頁</title><h1 id="a">Hi</h1>',
    ) {
      const res = await app.inject({
        method: 'POST',
        url: `/projects/${projectId}/versions`,
        headers: { cookie },
        payload: { html },
      });
      if (res.statusCode !== 201) throw new Error(`upload failed: ${res.body}`);
      return (res.json() as { version: { id: string; contentKey: string } }).version;
    },
    async createShare(cookie, projectId, role = 'commenter', extra = {}) {
      const res = await app.inject({
        method: 'POST',
        url: `/projects/${projectId}/share-links`,
        headers: { cookie },
        payload: { role, ...extra },
      });
      const j = res.json() as { token: string; link: { id: string } };
      return { token: j.token, id: j.link.id };
    },
    async guest(token, name = '訪客', guestToken) {
      const res = await app.inject({
        method: 'POST',
        url: `/share/${token}/guest`,
        payload: { name, ...(guestToken ? { guestToken } : {}) },
      });
      return (res.json() as { guestToken: string }).guestToken;
    },
    async close() {
      await app.close();
      await testDb.drop();
      await rm(storageRoot, { recursive: true, force: true });
    },
  };
  return h;
}

export function cookieOf(res: LightMyRequestResponse): string {
  const sc = res.cookies.find((c) => c.name === 'hpe_session');
  if (!sc) throw new Error(`no session cookie (status ${res.statusCode}): ${res.body}`);
  return `${sc.name}=${sc.value}`;
}

export function sampleAnchor(over: Partial<Anchor> = {}): Anchor {
  return {
    pageId: 'index.html',
    kind: 'element',
    viewport: { width: 1440, height: 900, dpr: 1 },
    selectors: {
      css: '#a',
      fingerprint: { tag: 'h1', classes: [], textHash: 'abc', siblingIndex: 0, depth: 2 },
      elementOffset: { x: 0.5, y: 0.5 },
    },
    fallback: { x: 10, y: 10, w: 100, h: 20 },
    snapshot: { tag: 'h1', text: 'Hi' },
    ...over,
  };
}

export function threadBody(body = '請調整這裡', tags?: ThreadTag[]) {
  return { anchor: sampleAnchor(), body, ...(tags ? { tags } : {}) };
}

export function shareHeaders(token: string, guestToken?: string): Record<string, string> {
  return { 'x-share-token': token, ...(guestToken ? { 'x-guest-token': guestToken } : {}) };
}

export function zipUploadRequest(
  zip: Buffer,
  extra: { entryPage?: string; filename?: string } = {},
) {
  return multipartBody([
    ...(extra.entryPage ? [{ name: 'entryPage', value: extra.entryPage }] : []),
    {
      name: 'file',
      filename: extra.filename ?? 'proto.zip',
      data: zip,
      contentType: 'application/zip',
    },
  ]);
}
