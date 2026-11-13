import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sha256Hex } from '../ids.js';
import { createHarness, shareHeaders, type Harness } from '../testing/harness.js';

let h: Harness;
let owner: string;
let projectId: string;
beforeAll(async () => {
  h = await createHarness();
  owner = await h.login('owner@example.com');
  projectId = (await h.createProject(owner)).id;
});
afterAll(() => h.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

describe('分享連結', () => {
  it('token 只回傳一次，DB 只存 sha256；url 為 APP_ORIGIN/s/<token>', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/projects/${projectId}/share-links`,
      headers: { cookie: owner },
      payload: { role: 'viewer' },
    });
    expect(res.statusCode).toBe(201);
    const { link, token, url } = res.json() as Json;
    expect(url).toBe(`http://localhost:5173/s/${token}`);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes base64url
    expect(link).toMatchObject({ projectId, role: 'viewer' });
    expect(link).not.toHaveProperty('token');

    const row = await h.testDb.pool.query('select * from share_links where id = $1', [link.id]);
    const stored = row.rows[0] as Record<string, string>;
    expect(stored.token_hash).toBe(sha256Hex(token));
    expect(JSON.stringify(row.rows)).not.toContain(token);

    const list = await h.app.inject({
      method: 'GET',
      url: `/projects/${projectId}/share-links`,
      headers: { cookie: owner },
    });
    expect(JSON.stringify(list.json())).not.toContain(token);
    expect((list.json() as Json).links.map((l: Json) => l.id)).toContain(link.id);
  });

  it('expiresAt 必須是未來；role 必須合法', async () => {
    const past = await h.app.inject({
      method: 'POST',
      url: `/projects/${projectId}/share-links`,
      headers: { cookie: owner },
      payload: { role: 'viewer', expiresAt: '2000-01-01T00:00:00Z' },
    });
    expect(past.statusCode).toBe(400);
    const role = await h.app.inject({
      method: 'POST',
      url: `/projects/${projectId}/share-links`,
      headers: { cookie: owner },
      payload: { role: 'owner' },
    });
    expect(role.statusCode).toBe(400);
  });

  it('GET /share/:token：回傳專案、角色與可用版本（不含 processing）', async () => {
    await h.uploadHtml(owner, projectId);
    const { token } = await h.createShare(owner, projectId, 'commenter');
    const res = await h.app.inject({ method: 'GET', url: `/share/${token}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      project: { id: projectId },
      role: 'commenter',
      versions: [{ number: 1, status: 'ready' }],
    });
  });

  it('撤銷：非擁有者 404、擁有者成功，只寫一次審計日誌', async () => {
    const link = await h.createShare(owner, projectId);
    const stranger = await h.login('s@example.com');
    expect(
      (
        await h.app.inject({
          method: 'DELETE',
          url: `/share-links/${link.id}`,
          headers: { cookie: stranger },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await h.app.inject({ method: 'DELETE', url: `/share-links/${link.id}` })).statusCode,
    ).toBe(401);
    expect(
      (
        await h.app.inject({
          method: 'DELETE',
          url: `/share-links/${link.id}`,
          headers: { cookie: owner },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await h.app.inject({
          method: 'DELETE',
          url: `/share-links/${link.id}`,
          headers: { cookie: owner },
        })
      ).statusCode,
    ).toBe(200);
    const audit = await h.testDb.pool.query(
      "select 1 from audit_log where action = 'share.revoke' and target = $1",
      [link.id],
    );
    expect(audit.rowCount).toBe(1);
    expect(
      (
        await h.app.inject({
          method: 'DELETE',
          url: '/share-links/nonexistent',
          headers: { cookie: owner },
        })
      ).statusCode,
    ).toBe(404);
  });

  it('guest identity：簽章 token、沿用舊 guestId、名字驗證、不能跨專案沿用', async () => {
    const { token } = await h.createShare(owner, projectId);
    const first = await h.app.inject({
      method: 'POST',
      url: `/share/${token}/guest`,
      payload: { name: '  小明 ' },
    });
    expect(first.statusCode).toBe(200);
    const a = first.json() as Json;
    expect(a.guest).toMatchObject({ name: '小明' });
    expect(a.guestToken).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    // guest token 裡沒有 session secret 以外的機密：payload 只含 gid/name/pid
    expect(JSON.parse(Buffer.from(a.guestToken.split('.')[0], 'base64url').toString())).toEqual({
      gid: a.guest.guestId,
      name: '小明',
      pid: projectId,
    });

    const again = await h.app.inject({
      method: 'POST',
      url: `/share/${token}/guest`,
      payload: { name: '小明二號', guestToken: a.guestToken },
    });
    expect(again.json()).toMatchObject({ guest: { guestId: a.guest.guestId, name: '小明二號' } });

    const forged = await h.app.inject({
      method: 'POST',
      url: `/share/${token}/guest`,
      payload: { name: 'x', guestToken: a.guestToken.slice(0, -3) + 'xxx' },
    });
    expect((forged.json() as Json).guest.guestId).not.toBe(a.guest.guestId);

    const p2 = (await h.createProject(owner, '二')).id;
    const other = await h.createShare(owner, p2);
    const cross = await h.app.inject({
      method: 'POST',
      url: `/share/${other.token}/guest`,
      payload: { name: 'x', guestToken: a.guestToken },
    });
    expect((cross.json() as Json).guest.guestId).not.toBe(a.guest.guestId);

    for (const name of ['', '   ', 'x'.repeat(41)]) {
      expect(
        (await h.app.inject({ method: 'POST', url: `/share/${token}/guest`, payload: { name } }))
          .statusCode,
      ).toBe(400);
    }
  });

  it('guest token 不能用來冒充擁有者或存取擁有者端點', async () => {
    const { token } = await h.createShare(owner, projectId, 'commenter');
    const g = await h.guest(token);
    const res = await h.app.inject({
      method: 'GET',
      url: '/projects',
      headers: shareHeaders(token, g),
    });
    expect(res.statusCode).toBe(403);
    const noShare = await h.app.inject({
      method: 'GET',
      url: '/projects',
      headers: { 'x-guest-token': g },
    });
    expect(noShare.statusCode).toBe(401);
  });
});
