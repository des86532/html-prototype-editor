import type { AddressInfo } from 'node:net';
import type { LiveServerMessage } from '@hpe/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import {
  createHarness,
  sampleMarkup,
  shareHeaders,
  threadBody,
  type Harness,
} from '../testing/harness.js';

let h: Harness;
let url: string;
let owner: string;
let projectId: string;
let versionId: string;
let commenter: { token: string; id: string };
let guestB: string;
const sockets: WebSocket[] = [];

function wsUrl(app: Harness['app'], id: string): string {
  const { port } = app.server.address() as AddressInfo;
  return `ws://127.0.0.1:${port}/versions/${id}/live`;
}

/** 緩衝所有收到的訊息，讓 nextMessage 不會漏掉在呼叫前就到達的訊息。 */
class Client {
  readonly ws: WebSocket;
  private readonly queue: LiveServerMessage[] = [];
  private waiters: (() => void)[] = [];
  closed: Promise<number>;

  constructor(
    target: string,
    headers: Record<string, string>,
    private readonly hello: Record<string, unknown> | null = {},
  ) {
    this.ws = new WebSocket(target, { headers });
    sockets.push(this.ws);
    this.ws.on('message', (d) => {
      this.queue.push(JSON.parse(d.toString()) as LiveServerMessage);
      this.waiters.splice(0).forEach((w) => w());
    });
    this.closed = new Promise((resolve) => this.ws.on('close', (code) => resolve(code)));
    this.ws.on('error', () => undefined);
    this.ws.on('open', () => {
      if (this.hello) this.send({ v: 1, type: 'hello', ...this.hello });
    });
  }

  send(msg: unknown): void {
    this.ws.send(JSON.stringify(msg));
  }

  async next<T extends LiveServerMessage['type']>(
    type: T,
  ): Promise<Extract<LiveServerMessage, { type: T }>> {
    const deadline = Date.now() + 2000;
    for (;;) {
      const i = this.queue.findIndex((m) => m.type === type);
      if (i >= 0) return this.queue.splice(i, 1)[0] as Extract<LiveServerMessage, { type: T }>;
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`timeout waiting for ${type}`);
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, left);
        this.waiters.push(() => {
          clearTimeout(t);
          resolve();
        });
      });
    }
  }

  count(type: LiveServerMessage['type']): number {
    return this.queue.filter((m) => m.type === type).length;
  }
}

function connect(headers: Record<string, string>, hello: Record<string, unknown> | null = {}) {
  return new Client(url, { origin: h.config.appOrigin, ...headers }, hello);
}

beforeAll(async () => {
  h = await createHarness();
  await h.app.listen({ port: 0, host: '127.0.0.1' });
  owner = await h.login('owner@example.com');
  projectId = (await h.createProject(owner)).id;
  versionId = (await h.uploadHtml(owner, projectId)).id;
  url = wsUrl(h.app, versionId);
  commenter = await h.createShare(owner, projectId, 'commenter');
  guestB = await h.guest(commenter.token, '訪客乙');
});
afterAll(async () => {
  for (const s of sockets) s.terminate();
  await h.close();
});

const asB = () => ({ shareToken: commenter.token, guestToken: guestB });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('握手', () => {
  it('沒有 Origin 或 Origin 錯誤 → 403，不升級', async () => {
    for (const headers of [{}, { origin: 'https://evil.example' }]) {
      const ws = new WebSocket(url, { headers: { cookie: owner, ...headers } });
      sockets.push(ws);
      const status = await new Promise<number>((resolve, reject) => {
        ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
        ws.on('open', () => reject(new Error('should not open')));
        ws.on('error', () => undefined);
      });
      expect(status).toBe(403);
    }
  });

  it('沒送 hello → close 4400', async () => {
    const quick = await createHarness({ config: { liveHelloTimeoutMs: 100 } });
    try {
      await quick.app.listen({ port: 0, host: '127.0.0.1' });
      const cookie = await quick.login('quick@example.com');
      const p = (await quick.createProject(cookie)).id;
      const v = (await quick.uploadHtml(cookie, p)).id;
      const c = new Client(wsUrl(quick.app, v), { origin: quick.config.appOrigin, cookie }, null);
      const code = await Promise.race([c.closed, sleep(500).then(() => 'timeout' as const)]);
      expect(code).toBe(4400);
    } finally {
      await quick.close();
    }
  });

  it('沒有 cookie 也沒有 token → close 4401', async () => {
    const c = connect({});
    expect(await c.closed).toBe(4401);
  });
});

describe('名單、游標與同步', () => {
  it('B 收到 welcome（含擁有者），A 收到 peerJoin；presence 與 cursor 轉送且限流', async () => {
    const a = connect({ cookie: owner });
    const aWelcome = await a.next('welcome');
    expect(aWelcome.peers).toEqual([]);

    const b = connect({}, asB());
    const bWelcome = await b.next('welcome');
    expect(bWelcome.peers).toHaveLength(1);
    expect(bWelcome.peers[0]).toMatchObject({ id: aWelcome.selfId, name: expect.any(String) });
    const join = await a.next('peerJoin');
    expect(join.peer).toMatchObject({ id: bWelcome.selfId, name: '訪客乙' });

    b.send({ v: 1, type: 'presence', pageId: 'index.html', width: 1440 });
    expect(await a.next('peerUpdate')).toMatchObject({
      id: bWelcome.selfId,
      pageId: 'index.html',
      width: 1440,
    });

    b.send({ v: 1, type: 'cursor', x: 5, y: 6 });
    expect(await a.next('cursor')).toMatchObject({ id: bWelcome.selfId, x: 5, y: 6 });

    await sleep(1100); // 讓 token bucket 回補
    for (let i = 0; i < 100; i++) b.send({ v: 1, type: 'cursor', x: i, y: i });
    await sleep(400);
    expect(a.count('cursor')).toBeLessThanOrEqual(31);
    expect(a.count('cursor')).toBeGreaterThan(0);

    // 標記與回覆即時同步
    const created = await h.app.inject({
      method: 'POST',
      url: `/versions/${versionId}/threads`,
      headers: { cookie: owner },
      payload: threadBody('第一則'),
    });
    expect(created.statusCode).toBe(201);
    const threadId = (created.json() as { thread: { id: string } }).thread.id;
    const up1 = await b.next('threadUpsert');
    expect(up1.thread).toMatchObject({ id: threadId, rev: 1 });
    // 發起者本人也會收到
    expect((await a.next('threadUpsert')).thread.id).toBe(threadId);

    const reply = await h.app.inject({
      method: 'POST',
      url: `/threads/${threadId}/comments`,
      headers: { cookie: owner },
      payload: { body: '回覆' },
    });
    expect(reply.statusCode).toBe(201);
    expect((await b.next('threadUpsert')).thread.rev).toBe(2);

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/threads/${threadId}`,
      headers: { cookie: owner },
    });
    expect(del.statusCode).toBe(200);
    expect(await b.next('threadDelete')).toMatchObject({ threadId });

    // B 斷線 → A 收到 peerLeave
    b.ws.close();
    expect(await a.next('peerLeave')).toMatchObject({ id: bWelcome.selfId });
    a.ws.close();
  });

  it('撤銷 B 的分享連結 → B 被 close 4403', async () => {
    const link = await h.createShare(owner, projectId, 'commenter');
    const guest = await h.guest(link.token, '訪客丙');
    const c = connect({}, { shareToken: link.token, guestToken: guest });
    await c.next('welcome');
    const res = await h.app.inject({
      method: 'DELETE',
      url: `/share-links/${link.id}`,
      headers: { cookie: owner },
    });
    expect(res.statusCode).toBe(200);
    expect(await c.closed).toBe(4403);
  });

  it('A 登出 → A 被 close 4401', async () => {
    const cookie = await h.login('logout@example.com');
    const p = (await h.createProject(cookie)).id;
    const v = (await h.uploadHtml(cookie, p)).id;
    const c = new Client(wsUrl(h.app, v), { origin: h.config.appOrigin, cookie });
    await c.next('welcome');
    const res = await h.app.inject({ method: 'POST', url: '/auth/logout', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(await c.closed).toBe(4401);
  });
});

describe('REST 與 rev', () => {
  it('shareHeaders 寫入也會廣播', async () => {
    const a = connect({ cookie: owner });
    await a.next('welcome');
    const res = await h.app.inject({
      method: 'POST',
      url: `/versions/${versionId}/threads`,
      headers: shareHeaders(commenter.token, guestB),
      payload: { markup: sampleMarkup() },
    });
    expect(res.statusCode).toBe(201);
    expect((await a.next('threadUpsert')).thread.number).toBeNull();
    a.ws.close();
  });
});
