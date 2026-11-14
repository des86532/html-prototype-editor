import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assets } from '../db/schema.js';
import { createHarness, threadBody, zipUploadRequest, type Harness } from '../testing/harness.js';
import { buildZip, multipartBody } from '../testing/zip.js';

let h: Harness;
let owner: string;
let other: string;
beforeAll(async () => {
  h = await createHarness();
  owner = await h.login('owner@example.com');
  other = await h.login('other@example.com');
});
afterAll(() => h.close());

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

async function upload(cookie: string, projectId: string, zip: Buffer, extra = {}) {
  const { body, contentType } = zipUploadRequest(zip, extra);
  return h.app.inject({
    method: 'POST',
    url: `/projects/${projectId}/versions`,
    headers: { cookie, 'content-type': contentType },
    payload: body,
  });
}

describe('專案 CRUD 與隔離', () => {
  it('建立、列出、取得（含 versions）、刪除；他人看不到', async () => {
    const p = await h.createProject(owner, 'P-隔離');
    const list = await h.app.inject({
      method: 'GET',
      url: '/projects',
      headers: { cookie: owner },
    });
    expect((list.json() as { projects: { id: string }[] }).projects.map((x) => x.id)).toContain(
      p.id,
    );

    const otherList = await h.app.inject({
      method: 'GET',
      url: '/projects',
      headers: { cookie: other },
    });
    expect((otherList.json() as { projects: unknown[] }).projects).toEqual([]);

    for (const [method, url] of [
      ['GET', `/projects/${p.id}`],
      ['DELETE', `/projects/${p.id}`],
      ['POST', `/projects/${p.id}/versions`],
      ['GET', `/projects/${p.id}/share-links`],
    ] as const) {
      const r = await h.app.inject({
        method,
        url,
        headers: { cookie: other },
        payload: method === 'POST' ? { html: '<p>x</p>' } : undefined,
      });
      expect(r.statusCode, `${method} ${url}`).toBe(404);
    }
    const anon = await h.app.inject({ method: 'GET', url: `/projects/${p.id}` });
    expect(anon.statusCode).toBe(401);

    const bad = await h.app.inject({
      method: 'POST',
      url: '/projects',
      headers: { cookie: owner },
      payload: { name: '   ' },
    });
    expect(bad.statusCode).toBe(400);

    const v = await h.uploadHtml(owner, p.id);
    const detail = await h.app.inject({
      method: 'GET',
      url: `/projects/${p.id}`,
      headers: { cookie: owner },
    });
    expect(detail.json()).toMatchObject({
      project: { id: p.id },
      versions: [{ id: v.id, number: 1 }],
    });

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/projects/${p.id}`,
      headers: { cookie: owner },
    });
    expect(del.statusCode).toBe(200);
    expect(
      (await h.app.inject({ method: 'GET', url: `/projects/${p.id}`, headers: { cookie: owner } }))
        .statusCode,
    ).toBe(404);
    const audit = await h.testDb.pool.query(
      "select target from audit_log where action = 'project.delete'",
    );
    expect(audit.rows.map((r: { target: string }) => r.target)).toContain(p.id);
  });
});

describe('匯入版本', () => {
  it('貼上原始碼 → index.html 單檔 bundle、分析報告、contentKey 格式', async () => {
    const p = await h.createProject(owner);
    const res = await h.app.inject({
      method: 'POST',
      url: `/projects/${p.id}/versions`,
      headers: { cookie: owner },
      payload: {
        html: '<title>貼上</title><script src="https://cdn.jsdelivr.net/x.js"></script><form></form>',
      },
    });
    expect(res.statusCode).toBe(201);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { version } = res.json() as { version: Record<string, any> };
    expect(version.number).toBe(1);
    expect(version.status).toBe('ready');
    expect(version.entryPage).toBe('index.html');
    expect(version.pages).toEqual([{ path: 'index.html', title: '貼上' }]);
    expect(version.contentKey).toMatch(/^[a-z2-7]{26}$/);
    expect(version.analysis.forms).toBe(1);
    expect(version.analysis.externalResources[0]).toMatchObject({ kind: 'script', blocked: true });
    expect(version.entryCandidates).toBeUndefined();
    const second = await h.uploadHtml(owner, p.id);
    const row = await h.app.inject({
      method: 'GET',
      url: `/versions/${second.id}`,
      headers: { cookie: owner },
    });
    expect(row.json()).toMatchObject({
      version: { number: 2 },
      role: 'owner',
      me: { kind: 'user' },
    });
  });

  it('multipart 單一 .html 檔案（檔名任意）→ index.html', async () => {
    const p = await h.createProject(owner);
    const { body, contentType } = multipartBody([
      {
        name: 'file',
        filename: 'Landing Page.HTML',
        data: Buffer.from('<title>L</title>'),
        contentType: 'text/plain',
      },
    ]);
    const res = await h.app.inject({
      method: 'POST',
      url: `/projects/${p.id}/versions`,
      headers: { cookie: owner, 'content-type': contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ version: { entryPage: 'index.html', status: 'ready' } });
  });

  it('zip：多頁、去除頂層資料夾、asset 以 sha256 儲存、MIME 由副檔名決定', async () => {
    const p = await h.createProject(owner);
    const zip = buildZip({
      'site/index.html':
        '<title>首頁</title><link rel="stylesheet" href="css/a.css"><a href="about.html">x</a>',
      'site/about.html': '<title>關於</title>',
      'site/css/a.css': 'body{color:red}',
      'site/data/x.json': '{"a":1}',
      'site/pic.svg': '<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>',
    });
    const res = await upload(owner, p.id, zip);
    expect(res.statusCode).toBe(201);
    const { version } = res.json() as {
      version: { id: string; entryPage: string; pages: unknown[] };
    };
    expect(version.entryPage).toBe('index.html');
    expect(version.pages).toEqual([
      { path: 'about.html', title: '關於' },
      { path: 'index.html', title: '首頁' },
    ]);
    const rows = await h.testDb.db.select().from(assets).where(eq(assets.versionId, version.id));
    const byPath = Object.fromEntries(rows.map((r) => [r.path, r]));
    expect(Object.keys(byPath).sort()).toEqual([
      'about.html',
      'css/a.css',
      'data/x.json',
      'index.html',
      'pic.svg',
    ]);
    expect(byPath['css/a.css']).toMatchObject({
      sha256: sha('body{color:red}'),
      mime: 'text/css',
      size: 15,
    });
    expect(byPath['data/x.json']!.mime).toBe('application/json');
    expect(byPath['pic.svg']!.mime).toBe('image/svg+xml');
    expect(await h.storage.has(sha('body{color:red}'))).toBe(true);
  });

  it('多頁沒有 index.html → processing + entryCandidates，PATCH 後可用', async () => {
    const p = await h.createProject(owner);
    const res = await upload(
      owner,
      p.id,
      buildZip({ 'a.html': '<title>A</title>', 'b.html': '<title>B</title>' }),
    );
    const { version } = res.json() as {
      version: {
        id: string;
        contentKey: string;
        status: string;
        entryPage: string;
        entryCandidates: string[];
      };
    };
    expect(version).toMatchObject({
      status: 'processing',
      entryPage: '',
      entryCandidates: ['a.html', 'b.html'],
    });

    // 尚未可用：不能留言、content server 查不到
    const t = await h.app.inject({
      method: 'POST',
      url: `/versions/${version.id}/threads`,
      headers: { cookie: owner },
      payload: threadBody('x'),
    });
    expect(t.statusCode).toBe(422);
    expect(t.json()).toMatchObject({ error: { code: 'IMPORT_ENTRY_REQUIRED' } });
    const internalProcessing = await h.app.inject({
      method: 'GET',
      url: `/internal/content/${version.contentKey}`,
      headers: { 'x-internal-token': 'test-internal-token' },
    });
    expect(internalProcessing.statusCode).toBe(404);

    const bad = await h.app.inject({
      method: 'PATCH',
      url: `/versions/${version.id}`,
      headers: { cookie: owner },
      payload: { entryPage: 'nope.html' },
    });
    expect(bad.statusCode).toBe(400);
    const ok = await h.app.inject({
      method: 'PATCH',
      url: `/versions/${version.id}`,
      headers: { cookie: owner },
      payload: { entryPage: 'b.html' },
    });
    expect(ok.json()).toMatchObject({ version: { status: 'ready', entryPage: 'b.html' } });
    expect(
      (ok.json() as { version: { entryCandidates?: unknown } }).version.entryCandidates,
    ).toBeUndefined();
  });

  it('multipart entryPage 欄位', async () => {
    const p = await h.createProject(owner);
    const res = await upload(owner, p.id, buildZip({ 'a.html': 'A', 'b.html': 'B' }), {
      entryPage: 'a.html',
    });
    expect(res.json()).toMatchObject({ version: { status: 'ready', entryPage: 'a.html' } });
  });

  it('V17：惡意壓縮檔 → 422 與明確的錯誤碼，且不建立版本', async () => {
    const p = await h.createProject(owner);
    const cases: [string, Buffer, string][] = [
      [
        'zip slip',
        buildZip({ 'index.html': 'x', '../../evil.html': 'x' }),
        'IMPORT_PATH_TRAVERSAL',
      ],
      [
        'symlink',
        buildZip({ 'index.html': 'x', 'l.html': { data: '/etc/passwd', mode: 0o120777 } }),
        'IMPORT_SYMLINK',
      ],
      [
        'bomb',
        buildZip({
          'index.html': 'x',
          'b.txt': { data: new Uint8Array(8 * 1024 * 1024), level: 9 },
        }),
        'IMPORT_COMPRESSION_RATIO',
      ],
      ['extension', buildZip({ 'index.html': 'x', 'a.exe': 'MZ' }), 'IMPORT_EXTENSION_NOT_ALLOWED'],
      ['absolute', buildZip({ '/abs.html': 'x' }), 'IMPORT_ABSOLUTE_PATH'],
      ['backslash', buildZip({ 'a\\b.html': 'x' }), 'IMPORT_BACKSLASH_PATH'],
      ['no html', buildZip({ 'a.css': 'x{}' }), 'IMPORT_NO_HTML'],
      ['garbage', Buffer.from('this is not a zip'), 'IMPORT_INVALID_ARCHIVE'],
    ];
    for (const [name, zip, code] of cases) {
      const res = await upload(owner, p.id, zip);
      expect(res.statusCode, name).toBe(422);
      expect(res.json(), name).toMatchObject({ error: { code } });
    }
    const detail = await h.app.inject({
      method: 'GET',
      url: `/projects/${p.id}`,
      headers: { cookie: owner },
    });
    expect((detail.json() as { versions: unknown[] }).versions).toEqual([]);
  });

  it('too many entries 與不接受的檔案類型', async () => {
    const p = await h.createProject(owner);
    const entries: Record<string, string> = { 'index.html': 'x' };
    for (let i = 0; i < 2000; i += 1) entries[`f${i}.txt`] = 'x';
    const many = await upload(owner, p.id, buildZip(entries));
    expect(many.statusCode).toBe(422);
    expect(many.json()).toMatchObject({ error: { code: 'IMPORT_TOO_MANY_ENTRIES' } });

    const { body, contentType } = multipartBody([
      { name: 'file', filename: 'x.exe', data: Buffer.from('MZ') },
    ]);
    const exe = await h.app.inject({
      method: 'POST',
      url: `/projects/${p.id}/versions`,
      headers: { cookie: owner, 'content-type': contentType },
      payload: body,
    });
    expect(exe.statusCode).toBe(422);
    expect(exe.json()).toMatchObject({ error: { code: 'IMPORT_EXTENSION_NOT_ALLOWED' } });
  });
});

describe('版本管理', () => {
  it('cdnAllowlist 只能是預設清單 origin；更新後 blocked 旗標與警告重算', async () => {
    const p = await h.createProject(owner);
    const v = await h.uploadHtml(
      owner,
      p.id,
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css"><script src="https://evil.example/x.js"></script>',
    );
    const bad = await h.app.inject({
      method: 'PATCH',
      url: `/versions/${v.id}`,
      headers: { cookie: owner },
      payload: { cdnAllowlist: ['https://evil.example'] },
    });
    expect(bad.statusCode).toBe(400);
    const ok = await h.app.inject({
      method: 'PATCH',
      url: `/versions/${v.id}`,
      headers: { cookie: owner },
      payload: { cdnAllowlist: ['https://fonts.googleapis.com'] },
    });
    const { version } = ok.json() as {
      version: {
        cdnAllowlist: string[];
        analysis: { externalResources: { url: string; blocked: boolean }[] };
      };
    };
    expect(version.cdnAllowlist).toEqual(['https://fonts.googleapis.com']);
    expect(
      version.analysis.externalResources.find((r) => r.url.includes('fonts.googleapis'))!.blocked,
    ).toBe(false);
    expect(
      version.analysis.externalResources.find((r) => r.url.includes('evil.example'))!.blocked,
    ).toBe(true);
    // internal content 回傳新的 allowlist
    const internal = await h.app.inject({
      method: 'GET',
      url: `/internal/content/${v.contentKey}`,
      headers: { 'x-internal-token': 'test-internal-token' },
    });
    expect(internal.json()).toMatchObject({ cdnAllowlist: ['https://fonts.googleapis.com'] });
    // 非擁有者不能改
    expect(
      (
        await h.app.inject({
          method: 'PATCH',
          url: `/versions/${v.id}`,
          headers: { cookie: other },
          payload: { cdnAllowlist: [] },
        })
      ).statusCode,
    ).toBe(404);
  });

  it('rotate-content-key：立即生效，舊 key 在 internal 查不到，並寫入審計日誌', async () => {
    const p = await h.createProject(owner);
    const v = await h.uploadHtml(owner, p.id);
    const internal = (key: string) =>
      h.app.inject({
        method: 'GET',
        url: `/internal/content/${key}`,
        headers: { 'x-internal-token': 'test-internal-token' },
      });
    expect((await internal(v.contentKey)).statusCode).toBe(200);

    expect(
      (
        await h.app.inject({
          method: 'POST',
          url: `/versions/${v.id}/rotate-content-key`,
          headers: { cookie: other },
        })
      ).statusCode,
    ).toBe(404);
    const res = await h.app.inject({
      method: 'POST',
      url: `/versions/${v.id}/rotate-content-key`,
      headers: { cookie: owner },
    });
    const rotated = (res.json() as { version: { contentKey: string } }).version.contentKey;
    expect(rotated).toMatch(/^[a-z2-7]{26}$/);
    expect(rotated).not.toBe(v.contentKey);
    expect((await internal(v.contentKey)).statusCode).toBe(404);
    expect((await internal(rotated)).statusCode).toBe(200);
    const audit = await h.testDb.pool.query(
      "select target, meta from audit_log where action = 'version.rotate_content_key'",
    );
    expect(audit.rows.some((r: { target: string }) => r.target === v.id)).toBe(true);
    expect(JSON.stringify(audit.rows)).not.toContain(v.contentKey);
  });

  it('刪除版本：只清除不再被參照的 blob，並寫入審計日誌', async () => {
    const p = await h.createProject(owner);
    const shared = 'shared{}';
    const v1 = (
      await upload(owner, p.id, buildZip({ 'index.html': '<p>one</p>', 'a.css': shared }))
    ).json() as { version: { id: string } };
    const v2 = (
      await upload(owner, p.id, buildZip({ 'index.html': '<p>two</p>', 'a.css': shared }))
    ).json() as { version: { id: string } };
    expect(await h.storage.has(sha('<p>one</p>'))).toBe(true);
    const del = await h.app.inject({
      method: 'DELETE',
      url: `/versions/${v1.version.id}`,
      headers: { cookie: owner },
    });
    expect(del.statusCode).toBe(200);
    expect(await h.storage.has(sha('<p>one</p>'))).toBe(false);
    expect(await h.storage.has(sha(shared))).toBe(true);
    expect(await h.storage.has(sha('<p>two</p>'))).toBe(true);
    expect(
      (
        await h.app.inject({
          method: 'GET',
          url: `/versions/${v2.version.id}`,
          headers: { cookie: owner },
        })
      ).statusCode,
    ).toBe(200);
    const audit = await h.testDb.pool.query(
      "select 1 from audit_log where action = 'version.delete'",
    );
    expect(audit.rowCount).toBeGreaterThan(0);
  });

  it('並行匯入同一專案：版本編號不重複', async () => {
    const p = await h.createProject(owner);
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        h.app.inject({
          method: 'POST',
          url: `/projects/${p.id}/versions`,
          headers: { cookie: owner },
          payload: { html: `<p>${i}</p>` },
        }),
      ),
    );
    expect(results.map((r) => r.statusCode)).toEqual([201, 201, 201, 201, 201, 201]);
    const numbers = results
      .map((r) => (r.json() as { version: { number: number } }).version.number)
      .sort();
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('internal 端點（content server 專用）', () => {
  it('沒有或錯誤的 x-internal-token → 401；正確 → manifest 與 blob', async () => {
    const p = await h.createProject(owner);
    const v = await h.uploadHtml(owner, p.id, '<title>I</title>');
    const url = `/internal/content/${v.contentKey}`;
    expect((await h.app.inject({ method: 'GET', url })).statusCode).toBe(401);
    expect(
      (await h.app.inject({ method: 'GET', url, headers: { 'x-internal-token': 'wrong' } }))
        .statusCode,
    ).toBe(401);
    // 使用者 session 不能代替 internal token
    expect(
      (await h.app.inject({ method: 'GET', url, headers: { cookie: owner } })).statusCode,
    ).toBe(401);

    const ok = await h.app.inject({
      method: 'GET',
      url,
      headers: { 'x-internal-token': 'test-internal-token' },
    });
    expect(ok.statusCode).toBe(200);
    const manifest = ok.json() as {
      versionId: string;
      entryPage: string;
      assets: { path: string; sha256: string; mime: string }[];
    };
    expect(manifest).toMatchObject({ versionId: v.id, entryPage: 'index.html', cdnAllowlist: [] });
    const asset = manifest.assets.find((a) => a.path === 'index.html')!;
    expect(asset.mime).toBe('text/html');

    const blobUrl = `/internal/blob/${asset.sha256}`;
    expect((await h.app.inject({ method: 'GET', url: blobUrl })).statusCode).toBe(401);
    const blob = await h.app.inject({
      method: 'GET',
      url: blobUrl,
      headers: { 'x-internal-token': 'test-internal-token' },
    });
    expect(blob.statusCode).toBe(200);
    expect(blob.body).toBe('<title>I</title>');
  });

  it('未被任何 asset 參照的 blob 不提供；格式不符與未知 contentKey → 404', async () => {
    const orphan = Buffer.from('orphan-data');
    const orphanSha = sha('orphan-data');
    await h.storage.put(orphanSha, orphan, orphan.length);
    const headers = { 'x-internal-token': 'test-internal-token' };
    expect(
      (await h.app.inject({ method: 'GET', url: `/internal/blob/${orphanSha}`, headers }))
        .statusCode,
    ).toBe(404);
    expect(
      (await h.app.inject({ method: 'GET', url: '/internal/blob/..%2F..%2Fetc%2Fpasswd', headers }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await h.app.inject({
          method: 'GET',
          url: '/internal/content/aaaaaaaaaaaaaaaaaaaaaaaaaa',
          headers,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await h.app.inject({ method: 'GET', url: '/internal/content/not-a-key', headers }))
        .statusCode,
    ).toBe(404);
  });
});

describe('csp-report', () => {
  it('各種 content-type 一律回 204，內容截斷後寫入 audit_log', async () => {
    const big = JSON.stringify({
      'csp-report': { 'blocked-uri': 'https://evil.example', pad: 'x'.repeat(20_000) },
    });
    for (const ct of [
      'application/csp-report',
      'application/reports+json',
      'application/json',
      'text/plain',
    ]) {
      const res = await h.app.inject({
        method: 'POST',
        url: '/csp-report',
        headers: { 'content-type': ct },
        payload: big,
      });
      expect(res.statusCode, ct).toBe(204);
    }
    const garbage = await h.app.inject({
      method: 'POST',
      url: '/csp-report',
      headers: { 'content-type': 'application/csp-report' },
      payload: '{not json',
    });
    expect(garbage.statusCode).toBe(204);
    const empty = await h.app.inject({ method: 'POST', url: '/csp-report' });
    expect(empty.statusCode).toBe(204);
    const huge = await h.app.inject({
      method: 'POST',
      url: '/csp-report',
      headers: { 'content-type': 'application/csp-report' },
      payload: 'x'.repeat(200_000),
    });
    expect(huge.statusCode).toBe(204);

    const rows = await h.testDb.pool.query(
      "select meta from audit_log where action = 'csp.violation'",
    );
    expect(rows.rowCount).toBeGreaterThanOrEqual(4);
    for (const r of rows.rows as { meta: { report: string } }[]) {
      expect(r.meta.report.length).toBeLessThanOrEqual(8 * 1024);
    }
  });
});
