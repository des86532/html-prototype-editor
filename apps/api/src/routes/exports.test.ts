import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { extractPayload } from '@hpe/exporter';
import { unzipSync, zipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createHarness,
  sampleAnchor,
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
  const mk = async (headers: Record<string, string>, text: string, tags?: string[]) =>
    (
      (
        await h.app.inject({
          method: 'POST',
          url: `/versions/${versionId}/threads`,
          headers,
          payload: { anchor: sampleAnchor(), body: text, ...(tags ? { tags } : {}) },
        })
      ).json() as Json
    ).thread as Json;
  const t1 = await mk({ cookie: owner }, '=HYPERLINK("evil")', ['bug']);
  await h.app.inject({
    method: 'POST',
    url: `/threads/${t1.id}/comments`,
    headers: guestHeaders,
    payload: { body: '<script>alert(1)</script>' },
  });
  const t2 = await mk(guestHeaders, '訪客的留言', ['copy']);
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
  it('json / markdown / csv：Content-Type、安全的 Content-Disposition、nosniff', async () => {
    const date = new Date().toISOString().slice(0, 10);
    for (const [fmt, ext, type] of [
      ['json', 'json', 'application/json'],
      ['markdown', 'md', 'text/markdown'],
      ['csv', 'csv', 'text/csv'],
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
    expect(json.items).toHaveLength(2);
    expect(json.items[0]['x-hpe:comments'][1].body).toBe('<script>alert(1)</script>');
    const csv = await get(`/versions/${versionId}/export/csv`);
    expect(csv.rawPayload.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(csv.body).toContain(`'=HYPERLINK`);
    const md = await get(`/versions/${versionId}/export/markdown`);
    expect(md.body).not.toContain('<script>');
  });

  it('?status / ?tag 篩選', async () => {
    const open = (await get(`/versions/${versionId}/export/json?status=open`)).json() as Json;
    expect(open.items).toHaveLength(1);
    const copy = (await get(`/versions/${versionId}/export/json?tag=copy`)).json() as Json;
    expect(copy.items).toHaveLength(1);
    expect(copy.items[0]['x-hpe:status']).toBe('resolved');
    expect((await get(`/versions/${versionId}/export/json?status=bogus`)).statusCode).toBe(400);
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
    for (const fmt of ['json', 'html', 'package']) {
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
    expect(j.packageBytes).toBeGreaterThan(0);
    expect(j.warnLargeHtml).toBe(false);
    expect(
      ((await get(`/versions/${versionId}/export-estimate?status=open`)).json() as Json)
        .threadCount,
    ).toBe(1);
  });
});

describe('import-package', () => {
  const upload = (pid: string, zip: Buffer | Uint8Array, filename = 'pkg.zip') => {
    const { body, contentType } = zipUploadRequest(Buffer.from(zip), { filename });
    return h.app.inject({
      method: 'POST',
      url: `/projects/${pid}/import-package`,
      headers: { cookie: owner, 'content-type': contentType },
      payload: body,
    });
  };
  const strip = (threads: Json[]) =>
    threads.map((t) => ({
      anchor: t.anchor,
      status: t.status,
      tags: t.tags,
      createdBy: t.createdBy.name, // kind 差異（user → imported guest）另行斷言
      createdAt: t.createdAt,
      resolvedAt: t.resolvedAt,
      comments: t.comments.map((c: Json) => ({
        body: c.body,
        name: c.author.name,
        createdAt: c.createdAt,
        editedAt: c.editedAt,
      })),
    }));

  it('往返：匯出 package → 匯入另一個專案，討論串 deep-equal（忽略 id／編號）', async () => {
    const pkg = await get(`/versions/${versionId}/export/package`);
    expect(pkg.statusCode).toBe(200);
    expect(pkg.headers['content-type']).toBe('application/zip');

    const target = (await h.createProject(owner, '目標')).id;
    await h.uploadHtml(owner, target); // 讓版本編號與 thread 編號不從頭開始也沒關係
    const res = await upload(target, pkg.rawPayload);
    expect(res.statusCode).toBe(201);
    const { version } = res.json() as Json;
    expect(version).toMatchObject({
      projectId: target,
      number: 2,
      status: 'ready',
      entryPage: 'index.html',
    });
    expect(version.pages).toEqual([{ path: 'index.html', title: '首頁' }]);

    const original = ((await get(`/versions/${versionId}/threads`)).json() as Json)
      .threads as Json[];
    const imported = ((await get(`/versions/${version.id}/threads`)).json() as Json)
      .threads as Json[];
    expect(imported).toHaveLength(2);
    expect(strip(imported)).toEqual(strip(original));
    expect(imported.map((t) => t.number)).toEqual([1, 2]);
    expect(imported[0]!.id).not.toBe(original[0]!.id);
    // 作者：user → 匯入 guest（不連結帳號），guest 保留 guestId
    expect(imported[0]!.createdBy).toMatchObject({
      kind: 'guest',
      guestId: expect.stringMatching(/^imported:/),
      name: 'owner',
    });
    expect(imported[1]!.createdBy).toMatchObject({
      kind: 'guest',
      guestId: original[1]!.createdBy.guestId,
    });
    // bundle 內容相同（content-addressed）
    const sha = createHash('sha256').update('h1{color:red}').digest('hex');
    expect(await h.storage.has(sha)).toBe(true);
  });

  it('匯入的版本重新分析，不信任 manifest；cdnAllowlist 必須是預設 origin', async () => {
    const pkg = (await get(`/versions/${versionId}/export/package`)).rawPayload;
    const files = unzipSync(new Uint8Array(pkg));
    const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']!));
    const rewrite = (m: unknown) =>
      zipSync({ ...files, 'manifest.json': new TextEncoder().encode(JSON.stringify(m)) });
    const target = (await h.createProject(owner, '分析')).id;

    const bad = await upload(
      target,
      rewrite({ ...manifest, cdnAllowlist: ['https://evil.example'] }),
    );
    expect(bad.statusCode).toBe(400);
    const ok = await upload(
      target,
      rewrite({
        ...manifest,
        cdnAllowlist: ['https://fonts.googleapis.com'],
        entryPage: 'missing.html',
      }),
    );
    expect(ok.statusCode).toBe(201);
    const { version } = ok.json() as Json;
    expect(version.cdnAllowlist).toEqual(['https://fonts.googleapis.com']);
    expect(version.entryPage).toBe('index.html'); // 無效的 manifest entry 退回自動偵測
    expect(version.analysis.scripts.inline).toBe(1);
  });

  it('惡意 package：bundle 內 zip slip → 422 IMPORT_PATH_TRAVERSAL，不建立版本也不寫入 storage', async () => {
    const pkg = (await get(`/versions/${versionId}/export/package`)).rawPayload;
    const files = unzipSync(new Uint8Array(pkg));
    const evil = 'evil-payload-marker';
    const hostile = zipSync({ ...files, 'bundle/../../evil.html': new TextEncoder().encode(evil) });
    const target = (await h.createProject(owner, '被攻擊')).id;
    const res = await upload(target, hostile);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: { code: 'IMPORT_PATH_TRAVERSAL' } });
    const detail = (await get(`/projects/${target}`)).json() as Json;
    expect(detail.versions).toEqual([]);
    expect(await h.storage.has(createHash('sha256').update(evil).digest('hex'))).toBe(false);
    const threads = await h.testDb.pool.query('select 1 from threads where project_id = $1', [
      target,
    ]);
    expect(threads.rowCount).toBe(0);
  });

  it('其他惡意／錯誤輸入：symlink、非 zip、缺 manifest、副檔名、非擁有者', async () => {
    const pkg = (await get(`/versions/${versionId}/export/package`)).rawPayload;
    const files = unzipSync(new Uint8Array(pkg));
    const target = (await h.createProject(owner, '其他')).id;
    const sym = zipSync({
      ...files,
      'bundle/link.html': [
        new TextEncoder().encode('/etc/passwd'),
        { os: 3, attrs: (0o120777 << 16) >>> 0 },
      ],
    });
    expect((await upload(target, sym)).json()).toMatchObject({ error: { code: 'IMPORT_SYMLINK' } });
    expect((await upload(target, Buffer.from('nope'))).json()).toMatchObject({
      error: { code: 'IMPORT_INVALID_ARCHIVE' },
    });
    const { 'manifest.json': _m, ...noManifest } = files;
    expect((await upload(target, zipSync(noManifest))).json()).toMatchObject({
      error: { code: 'IMPORT_INVALID_ARCHIVE' },
    });
    expect(
      (await upload(target, zipSync({ ...files, 'bundle/x.exe': new Uint8Array(4) }))).json(),
    ).toMatchObject({ error: { code: 'IMPORT_EXTENSION_NOT_ALLOWED' } });
    expect((await upload(target, pkg, 'pkg.txt')).statusCode).toBe(422);

    const stranger = await h.login('stranger@example.com');
    const { body, contentType } = zipUploadRequest(pkg);
    const res = await h.app.inject({
      method: 'POST',
      url: `/projects/${target}/import-package`,
      headers: { cookie: stranger, 'content-type': contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(404);
    expect((await get(`/projects/${target}`)).json()).toMatchObject({ versions: [] });
  });
});
