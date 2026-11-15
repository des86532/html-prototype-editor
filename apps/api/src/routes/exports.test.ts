import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { extractPayload } from '@hpe/exporter';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createHarness,
  sampleMarkup,
  shareHeaders,
  zipUploadRequest,
  type Harness,
} from '../testing/harness.js';
import { buildZip } from '../testing/zip.js';

const SHELL = `<!doctype html><html><head><title>shell</title></head><body><script type="application/json" id="hpe-data"><!--HPE_PAYLOAD--></script></body></html>`;
const AGENT = 'window.__agent=1;';

let h: Harness;
let dir: string;
let owner: string;
let projectId: string;
let versionId: string;
let guestHeaders: Record<string, string>;

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'hpe-export-'));
  await writeFile(path.join(dir, 'shell.html'), SHELL);
  await writeFile(path.join(dir, 'agent.js'), AGENT);
  h = await createHarness({
    config: {
      exportShellPath: path.join(dir, 'shell.html'),
      agentBundlePath: path.join(dir, 'agent.js'),
    },
  });
  owner = await h.login('owner@example.com');
  projectId = (await h.createProject(owner, 'Café 專案')).id;
  const { body, contentType } = zipUploadRequest(
    buildZip({
      'index.html':
        '<title>首頁</title><link rel="stylesheet" href="a.css"><h1 id="a">Hi</h1><script>var x="</scr"+"ipt>"</script>',
      'a.css': 'h1{color:red}',
    }),
  );
  const up = await h.app.inject({
    method: 'POST',
    url: `/projects/${projectId}/versions`,
    headers: { cookie: owner, 'content-type': contentType },
    payload: body,
  });
  versionId = (up.json() as Json).version.id;

  const share = await h.createShare(owner, projectId, 'commenter');
  guestHeaders = shareHeaders(share.token, await h.guest(share.token, '訪客小明'));
  const mk = async (headers: Record<string, string>, text: string) =>
    (
      (
        await h.app.inject({
          method: 'POST',
          url: `/versions/${versionId}/threads`,
          headers,
          payload: { markup: sampleMarkup(), body: text },
        })
      ).json() as Json
    ).thread as Json;
  const t1 = await mk({ cookie: owner }, '=HYPERLINK("evil")');
  await h.app.inject({
    method: 'POST',
    url: `/threads/${t1.id}/comments`,
    headers: guestHeaders,
    payload: { body: '<script>alert(1)</script>' },
  });
  const t2 = await mk(guestHeaders, '訪客的留言');
  await h.app.inject({
    method: 'PATCH',
    url: `/threads/${t2.id}`,
    headers: { cookie: owner },
    payload: { status: 'resolved' },
  });
});
afterAll(async () => {
  await h.close();
  await rm(dir, { recursive: true, force: true });
});

const get = (url: string, headers: Record<string, string> = { cookie: owner }) =>
  h.app.inject({ method: 'GET', url, headers });

describe('export', () => {
  it('json / markdown：Content-Type、安全的 Content-Disposition、nosniff', async () => {
    const date = new Date().toISOString().slice(0, 10);
    for (const [fmt, ext, type] of [
      ['json', 'json', 'application/json'],
      ['markdown', 'md', 'text/markdown'],
    ] as const) {
      const res = await get(`/versions/${versionId}/export/${fmt}`);
      expect(res.statusCode, fmt).toBe(200);
      expect(String(res.headers['content-type'])).toContain(type);
      expect(res.headers['content-disposition']).toBe(
        `attachment; filename="review-cafe-v1-${date}.${ext}"`,
      );
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    }
    const json = (await get(`/versions/${versionId}/export/json`)).json() as Json;
    expect(json.schemaVersion).toBe(2);
    expect(json.items).toHaveLength(2);
    expect(json.items[0]['x-hpe:comments'][1].body).toBe('<script>alert(1)</script>');
    const md = await get(`/versions/${versionId}/export/markdown`);
    expect(md.body).not.toContain('<script>');
  });

  it('?status 篩選；已移除的格式回 400', async () => {
    const open = (await get(`/versions/${versionId}/export/json?status=open`)).json() as Json;
    expect(open.items).toHaveLength(1);
    const resolved = (
      await get(`/versions/${versionId}/export/json?status=resolved`)
    ).json() as Json;
    expect(resolved.items).toHaveLength(1);
    expect(resolved.items[0]['x-hpe:status']).toBe('resolved');
    expect((await get(`/versions/${versionId}/export/json?status=bogus`)).statusCode).toBe(400);
    for (const gone of ['csv', 'package']) {
      expect((await get(`/versions/${versionId}/export/${gone}`)).statusCode).toBe(400);
    }
  });

  it('html：單檔 shell + 內嵌 payload（頁面已 inline、script 跳脫）', async () => {
    const res = await get(`/versions/${versionId}/export/html`);
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['content-type'])).toContain('text/html');
    expect(res.headers['content-disposition']).toMatch(/filename="review-cafe-v1-[\d-]+\.html"/);
    const payload = extractPayload(res.body);
    expect(payload.agentSource).toBe(AGENT);
    expect(payload.annotations.items).toHaveLength(2);
    expect(payload.pages['index.html']).toContain('h1{color:red}');
    expect(res.body).toContain("connect-src 'none'");
  });

  it('html：缺少建置產物 → 500 INTERNAL，訊息說明缺哪個檔案與如何建置', async () => {
    const broken = await createHarness({
      config: {
        exportShellPath: path.join(dir, 'nope.html'),
        agentBundlePath: path.join(dir, 'agent.js'),
      },
    });
    try {
      const o = await broken.login('o@example.com');
      const p = await broken.createProject(o);
      const v = await broken.uploadHtml(o, p.id);
      const res = await broken.app.inject({
        method: 'GET',
        url: `/versions/${v.id}/export/html`,
        headers: { cookie: o },
      });
      expect(res.statusCode).toBe(500);
      const err = (res.json() as Json).error;
      expect(err.code).toBe('INTERNAL');
      expect(err.message).toContain('nope.html');
      expect(err.message).toContain('export-viewer');
    } finally {
      await broken.close();
    }
  });

  it('僅限擁有者，格式必須合法，並寫入審計日誌', async () => {
    const share = await h.createShare(owner, projectId, 'viewer');
    for (const fmt of ['json', 'html', 'markdown']) {
      expect(
        (await get(`/versions/${versionId}/export/${fmt}`, shareHeaders(share.token))).statusCode,
      ).toBe(403);
      expect(
        (
          await get(`/versions/${versionId}/export/${fmt}`, {
            cookie: await h.login('x@example.com'),
          })
        ).statusCode,
      ).toBe(404);
      expect((await get(`/versions/${versionId}/export/${fmt}`, {})).statusCode).toBe(401);
    }
    expect((await get(`/versions/${versionId}/export/docx`)).statusCode).toBe(400);
    expect(
      (await get(`/versions/${versionId}/export-estimate`, shareHeaders(share.token))).statusCode,
    ).toBe(403);
    const audit = await h.testDb.pool.query(
      "select 1 from audit_log where action like 'export.%' and target = $1",
      [versionId],
    );
    expect(audit.rowCount).toBeGreaterThanOrEqual(5);
  });

  it('export-estimate', async () => {
    const res = await get(`/versions/${versionId}/export-estimate`);
    expect(res.statusCode).toBe(200);
    const j = res.json() as Json;
    expect(j.threadCount).toBe(2);
    expect(j.htmlBytes).toBeGreaterThan(SHELL.length);
    expect(j.warnLargeHtml).toBe(false);
    expect(
      ((await get(`/versions/${versionId}/export-estimate?status=open`)).json() as Json)
        .threadCount,
    ).toBe(1);
  });
});
