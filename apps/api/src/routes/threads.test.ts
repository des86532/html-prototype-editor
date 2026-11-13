import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createHarness,
  sampleAnchor,
  shareHeaders,
  threadBody,
  type Harness,
} from '../testing/harness.js';

let h: Harness;
let now = new Date();
let owner: string;
let projectId: string;
let versionId: string;
let commenter: { token: string; id: string };
let viewer: { token: string; id: string };
let guestA: string;
let guestB: string;

beforeAll(async () => {
  h = await createHarness({ now: () => now });
  owner = await h.login('owner@example.com');
  projectId = (await h.createProject(owner)).id;
  versionId = (await h.uploadHtml(owner, projectId)).id;
  commenter = await h.createShare(owner, projectId, 'commenter');
  viewer = await h.createShare(owner, projectId, 'viewer');
  guestA = await h.guest(commenter.token, '訪客甲');
  guestB = await h.guest(commenter.token, '訪客乙');
});
afterAll(() => h.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const post = (url: string, headers: Record<string, string>, payload: unknown) =>
  h.app.inject({ method: 'POST', url, headers, payload: payload as object });
const patch = (url: string, headers: Record<string, string>, payload: unknown) =>
  h.app.inject({ method: 'PATCH', url, headers, payload: payload as object });
const del = (url: string, headers: Record<string, string>) =>
  h.app.inject({ method: 'DELETE', url, headers });

const asOwner = () => ({ cookie: owner });
const asA = () => shareHeaders(commenter.token, guestA);
const asB = () => shareHeaders(commenter.token, guestB);

async function newThread(headers: Record<string, string>, body = '內容') {
  const res = await post(`/versions/${versionId}/threads`, headers, threadBody(body));
  expect(res.statusCode).toBe(201);
  return (res.json() as Json).thread as Json;
}

describe('討論串建立與編號', () => {
  it('建立 thread 帶第一則留言，回傳 ThreadResponse 形狀', async () => {
    const t = await newThread(asOwner(), '第一則');
    expect(t).toMatchObject({
      versionId,
      status: 'open',
      tags: [],
      createdBy: { kind: 'user', name: 'owner' },
      comments: [{ body: '第一則', author: { kind: 'user' } }],
    });
    expect(t.anchor).toEqual(sampleAnchor());
    expect(t.resolvedAt).toBeUndefined();
    expect(typeof t.number).toBe('number');
  });

  it('並行建立：編號在專案內唯一且連續', async () => {
    const p2 = (await h.createProject(owner, '編號')).id;
    const v2 = (await h.uploadHtml(owner, p2)).id;
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        post(`/versions/${v2}/threads`, asOwner(), threadBody(`t${i}`)),
      ),
    );
    expect(results.map((r) => r.statusCode)).toEqual(Array(20).fill(201));
    const numbers = results
      .map((r) => ((r.json() as Json).thread as Json).number as number)
      .sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    // 同專案的另一個版本繼續接續編號；其他專案自己從 1 開始
    const v3 = (await h.uploadHtml(owner, p2)).id;
    const next = await post(`/versions/${v3}/threads`, asOwner(), threadBody('next'));
    expect(((next.json() as Json).thread as Json).number).toBe(21);
    const other = await newThread(asOwner());
    expect(other.number).toBeGreaterThanOrEqual(1);
  });

  it('刪除 thread 後編號不重用', async () => {
    const t1 = await newThread(asOwner());
    await del(`/threads/${t1.id}`, asOwner());
    const t2 = await newThread(asOwner());
    expect(t2.number).toBeGreaterThan(t1.number);
  });

  it('驗證：anchor 結構、body 長度與空白', async () => {
    const url = `/versions/${versionId}/threads`;
    expect((await post(url, asOwner(), { anchor: { nope: 1 }, body: 'x' })).statusCode).toBe(400);
    expect((await post(url, asOwner(), threadBody('   '))).statusCode).toBe(400);
    expect((await post(url, asOwner(), threadBody('x'.repeat(5001)))).statusCode).toBe(400);
    expect((await post(url, asOwner(), threadBody('x'.repeat(5000)))).statusCode).toBe(201);
    expect((await post(url, asOwner(), threadBody('x', ['bug', 'nope'] as never))).statusCode).toBe(
      400,
    );
    const tagged = await post(url, asOwner(), threadBody('tagged', ['bug', 'bug', 'copy']));
    expect(((tagged.json() as Json).thread as Json).tags).toEqual(['bug', 'copy']);
  });

  it('留言內容逐字儲存，不解析、不轉義', async () => {
    const nasty =
      '<script>alert(1)</script> [x](javascript:alert(1)) </script><script> =HYPERLINK("evil")';
    const t = await newThread(asOwner(), nasty);
    expect(t.comments[0].body).toBe(nasty);
    const list = await h.app.inject({
      method: 'GET',
      url: `/versions/${versionId}/threads`,
      headers: asOwner(),
    });
    const found = ((list.json() as Json).threads as Json[]).find((x) => x.id === t.id)!;
    expect(found.comments[0].body).toBe(nasty);
  });
});

describe('回覆、編輯、刪除留言', () => {
  it('回覆 → 編輯（設定 editedAt）→ 刪除；刪除最後一則連 thread 一起刪', async () => {
    const t = await newThread(asA(), '原始');
    const reply = await post(`/threads/${t.id}/comments`, asOwner(), { body: '擁有者回覆' });
    expect(reply.statusCode).toBe(201);
    const withReply = (reply.json() as Json).thread as Json;
    expect(withReply.comments.map((c: Json) => c.body)).toEqual(['原始', '擁有者回覆']);
    expect(withReply.comments[1].editedAt).toBeUndefined();

    const cid = withReply.comments[1].id as string;
    const edited = await patch(`/comments/${cid}`, asOwner(), { body: '改過' });
    const editedComment = (((edited.json() as Json).thread as Json).comments as Json[])[1]!;
    expect(editedComment).toMatchObject({ body: '改過' });
    expect(typeof editedComment.editedAt).toBe('string');

    const d1 = await del(`/comments/${cid}`, asOwner());
    expect(d1.json()).toMatchObject({ thread: { id: t.id, comments: [{ body: '原始' }] } });
    const d2 = await del(`/comments/${t.comments[0].id}`, asA());
    expect(d2.statusCode).toBe(200);
    expect(d2.json()).toEqual({ thread: null });
    const list = await h.app.inject({
      method: 'GET',
      url: `/versions/${versionId}/threads`,
      headers: asOwner(),
    });
    expect(((list.json() as Json).threads as Json[]).some((x) => x.id === t.id)).toBe(false);
    const audit = await h.testDb.pool.query(
      "select 1 from audit_log where action = 'thread.delete' and target = $1",
      [t.id],
    );
    expect(audit.rowCount).toBe(1);
  });

  it('狀態：resolve 設定 resolvedAt，reopen 清除；標籤去重並限制數量', async () => {
    const t = await newThread(asOwner());
    const r = await patch(`/threads/${t.id}`, asOwner(), { status: 'resolved' });
    const resolved = (r.json() as Json).thread as Json;
    expect(resolved.status).toBe('resolved');
    expect(typeof resolved.resolvedAt).toBe('string');
    const o = await patch(`/threads/${t.id}`, asOwner(), {
      status: 'open',
      tags: ['design', 'design', 'bug'],
    });
    const reopened = (o.json() as Json).thread as Json;
    expect(reopened.status).toBe('open');
    expect(reopened.resolvedAt).toBeUndefined();
    expect(reopened.tags).toEqual(['design', 'bug']);
    expect((await patch(`/threads/${t.id}`, asOwner(), {})).statusCode).toBe(400);
    expect(
      (
        await patch(`/threads/${t.id}`, asOwner(), {
          tags: ['bug', 'copy', 'design', 'question', 'suggestion', 'bug2'],
        })
      ).statusCode,
    ).toBe(400);
  });
});

describe('授權矩陣', () => {
  it('commenter 只能管理自己建立的 thread 與自己的留言；擁有者可以管理全部', async () => {
    const tA = await newThread(asA(), 'A 的');
    const tB = await newThread(asB(), 'B 的');

    // 自己的 thread：可改狀態、標籤、刪除
    expect(
      (await patch(`/threads/${tA.id}`, asA(), { status: 'resolved', tags: ['bug'] })).statusCode,
    ).toBe(200);
    // 別人的 thread：不行
    for (const res of [
      await patch(`/threads/${tB.id}`, asA(), { status: 'resolved' }),
      await del(`/threads/${tB.id}`, asA()),
    ]) {
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
    }
    // 可以回覆別人的 thread，但不能編輯／刪除別人的留言
    const reply = await post(`/threads/${tB.id}/comments`, asA(), { body: 'A 回覆 B' });
    expect(reply.statusCode).toBe(201);
    const bComment = tB.comments[0].id as string;
    const aReply = (((reply.json() as Json).thread as Json).comments as Json[])[1]!.id as string;
    expect((await patch(`/comments/${bComment}`, asA(), { body: 'hack' })).statusCode).toBe(403);
    expect((await del(`/comments/${bComment}`, asA())).statusCode).toBe(403);
    expect((await patch(`/comments/${aReply}`, asA(), { body: 'A 改自己的' })).statusCode).toBe(
      200,
    );
    // 擁有者：可改任何人的 thread 狀態、刪任何留言，但不能改寫別人的留言內容
    expect((await patch(`/threads/${tB.id}`, asOwner(), { status: 'resolved' })).statusCode).toBe(
      200,
    );
    expect((await patch(`/comments/${aReply}`, asOwner(), { body: '竄改' })).statusCode).toBe(403);
    expect((await del(`/comments/${aReply}`, asOwner())).statusCode).toBe(200);
    expect((await del(`/threads/${tA.id}`, asOwner())).statusCode).toBe(200);
    expect((await del(`/threads/${tB.id}`, asOwner())).statusCode).toBe(200);
  });

  it('viewer 只能讀：寫入一律 SHARE_ROLE_FORBIDDEN', async () => {
    const t = await newThread(asOwner());
    const headers = shareHeaders(viewer.token, await h.guest(viewer.token, '唯讀'));
    const list = await h.app.inject({
      method: 'GET',
      url: `/versions/${versionId}/threads`,
      headers,
    });
    expect(list.statusCode).toBe(200);
    const detail = await h.app.inject({ method: 'GET', url: `/versions/${versionId}`, headers });
    expect(detail.json()).toMatchObject({ role: 'viewer', me: { kind: 'guest', name: '唯讀' } });
    const attempts = [
      await post(`/versions/${versionId}/threads`, headers, threadBody()),
      await post(`/threads/${t.id}/comments`, headers, { body: 'x' }),
      await patch(`/threads/${t.id}`, headers, { status: 'resolved' }),
      await patch(`/comments/${t.comments[0].id}`, headers, { body: 'x' }),
      await del(`/comments/${t.comments[0].id}`, headers),
      await del(`/threads/${t.id}`, headers),
    ];
    for (const res of attempts) {
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: { code: 'SHARE_ROLE_FORBIDDEN' } });
    }
  });

  it('commenter 沒有 / 偽造 / 其他專案的 guest token → GUEST_REQUIRED', async () => {
    const p2 = (await h.createProject(owner, '另一個')).id;
    const share2 = await h.createShare(owner, p2, 'commenter');
    const foreign = await h.guest(share2.token, '別的專案');
    const forged = guestA.split('.')[0] + '.' + 'A'.repeat(43);
    for (const headers of [
      shareHeaders(commenter.token),
      shareHeaders(commenter.token, foreign),
      shareHeaders(commenter.token, forged),
      shareHeaders(commenter.token, 'garbage'),
    ]) {
      const res = await post(`/versions/${versionId}/threads`, headers, threadBody());
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: { code: 'GUEST_REQUIRED' } });
    }
    // 沒有 guest token 仍可讀取
    const list = await h.app.inject({
      method: 'GET',
      url: `/versions/${versionId}/threads`,
      headers: shareHeaders(commenter.token),
    });
    expect(list.statusCode).toBe(200);
  });

  it('跨專案：分享連結只能存取自己的專案（其餘 404），其他使用者的專案也是 404', async () => {
    const p2 = (await h.createProject(owner, '另一個')).id;
    const v2 = (await h.uploadHtml(owner, p2)).id;
    const t2 = await newThread(asOwner());
    void t2;
    expect(
      (await h.app.inject({ method: 'GET', url: `/versions/${v2}`, headers: asA() })).statusCode,
    ).toBe(404);
    expect(
      (await h.app.inject({ method: 'GET', url: `/versions/${v2}/threads`, headers: asA() }))
        .statusCode,
    ).toBe(404);
    expect((await post(`/versions/${v2}/threads`, asA(), threadBody())).statusCode).toBe(404);

    const t3 = ((await post(`/versions/${v2}/threads`, asOwner(), threadBody('p2'))).json() as Json)
      .thread as Json;
    for (const res of [
      await post(`/threads/${t3.id}/comments`, asA(), { body: 'x' }),
      await patch(`/threads/${t3.id}`, asA(), { status: 'resolved' }),
      await patch(`/comments/${t3.comments[0].id}`, asA(), { body: 'x' }),
      await del(`/comments/${t3.comments[0].id}`, asA()),
      await del(`/threads/${t3.id}`, asA()),
    ]) {
      expect(res.statusCode).toBe(404);
    }

    const stranger = await h.login('stranger@example.com');
    for (const res of [
      await h.app.inject({
        method: 'GET',
        url: `/versions/${versionId}`,
        headers: { cookie: stranger },
      }),
      await h.app.inject({
        method: 'GET',
        url: `/versions/${versionId}/threads`,
        headers: { cookie: stranger },
      }),
      await post(`/versions/${versionId}/threads`, { cookie: stranger }, threadBody()),
      await post(`/threads/${t3.id}/comments`, { cookie: stranger }, { body: 'x' }),
      await del(`/threads/${t3.id}`, { cookie: stranger }),
    ]) {
      expect(res.statusCode).toBe(404);
    }
  });

  it('分享連結使用者不能使用擁有者專屬操作', async () => {
    for (const res of [
      await h.app.inject({ method: 'GET', url: `/projects/${projectId}`, headers: asA() }),
      await h.app.inject({
        method: 'GET',
        url: `/projects/${projectId}/share-links`,
        headers: asA(),
      }),
      await post(`/projects/${projectId}/share-links`, asA(), { role: 'commenter' }),
      await post(`/projects/${projectId}/versions`, asA(), { html: '<p>x</p>' }),
      await post(`/versions/${versionId}/rotate-content-key`, asA(), {}),
      await patch(`/versions/${versionId}`, asA(), { cdnAllowlist: [] }),
      await del(`/versions/${versionId}`, asA()),
      await del(`/share-links/${commenter.id}`, asA()),
      await h.app.inject({ method: 'GET', url: '/me', headers: asA() }),
    ]) {
      expect([401, 403]).toContain(res.statusCode);
    }
    // share token 優先於 cookie：就算同時帶 owner cookie，也只有 share 權限
    const both = await h.app.inject({
      method: 'GET',
      url: `/projects/${projectId}`,
      headers: { ...asA(), cookie: owner },
    });
    expect(both.statusCode).toBe(403);
  });

  it('未帶任何身分 → 401', async () => {
    for (const res of [
      await h.app.inject({ method: 'GET', url: `/versions/${versionId}` }),
      await h.app.inject({ method: 'GET', url: `/versions/${versionId}/threads` }),
      await post(`/versions/${versionId}/threads`, {}, threadBody()),
    ]) {
      expect(res.statusCode).toBe(401);
    }
    const missing = await h.app.inject({
      method: 'GET',
      url: '/versions/01ARZ3NDEKTSV4RRFFQ69G5FAV',
    });
    expect(missing.statusCode).toBe(401);
  });

  it('撤銷後 403 SHARE_REVOKED，過期後 403 SHARE_EXPIRED（API 端 V23）', async () => {
    const link = await h.createShare(owner, projectId, 'commenter', {
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    });
    const guest = await h.guest(link.token);
    const headers = shareHeaders(link.token, guest);
    expect((await post(`/versions/${versionId}/threads`, headers, threadBody())).statusCode).toBe(
      201,
    );

    const base = now;
    now = new Date(base.getTime() + 120_000);
    for (const res of [
      await h.app.inject({ method: 'GET', url: `/versions/${versionId}/threads`, headers }),
      await post(`/versions/${versionId}/threads`, headers, threadBody()),
      await h.app.inject({ method: 'GET', url: `/share/${link.token}` }),
    ]) {
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: { code: 'SHARE_EXPIRED' } });
    }
    now = base;

    const ok = await del(`/share-links/${link.id}`, asOwner());
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as Json).link.revokedAt).toEqual(expect.any(String));
    for (const res of [
      await h.app.inject({ method: 'GET', url: `/versions/${versionId}/threads`, headers }),
      await post(`/versions/${versionId}/threads`, headers, threadBody()),
      await h.app.inject({ method: 'GET', url: `/share/${link.token}` }),
      await post(`/share/${link.token}/guest`, {}, { name: 'x' }),
    ]) {
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: { code: 'SHARE_REVOKED' } });
    }
    // 其他分享連結不受影響
    expect(
      (await h.app.inject({ method: 'GET', url: `/versions/${versionId}/threads`, headers: asA() }))
        .statusCode,
    ).toBe(200);
  });

  it('不存在的 share token → 404（不洩漏）', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/versions/${versionId}`,
      headers: shareHeaders('nope'.repeat(11)),
    });
    expect(res.statusCode).toBe(404);
    expect((await h.app.inject({ method: 'GET', url: '/share/nope' })).statusCode).toBe(404);
  });
});

describe('留言頻率限制', () => {
  it('超過限制回 429（以 IP + shareToken 為 key）', async () => {
    const limited = await createHarness({
      config: {
        rateLimits: {
          authRequest: { capacity: 100, refillPerSecond: 100 },
          shareOpen: { capacity: 3, refillPerSecond: 0.001 },
          guestIdentity: { capacity: 2, refillPerSecond: 0.001 },
          commentWrite: { capacity: 2, refillPerSecond: 0.001 },
          cspReport: { capacity: 100, refillPerSecond: 100 },
        },
      },
    });
    try {
      const o = await limited.login('rl@example.com');
      const p = (await limited.createProject(o)).id;
      const v = (await limited.uploadHtml(o, p)).id;
      const l1 = await limited.createShare(o, p, 'commenter');
      const l2 = await limited.createShare(o, p, 'commenter');

      const g1 = await limited.guest(l1.token);
      await limited.guest(l1.token);
      const g3 = await limited.app.inject({
        method: 'POST',
        url: `/share/${l1.token}/guest`,
        payload: { name: 'x' },
      });
      expect(g3.statusCode).toBe(429);
      expect(g3.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
      // 另一個 shareToken 有自己的 bucket
      expect(
        (
          await limited.app.inject({
            method: 'POST',
            url: `/share/${l2.token}/guest`,
            payload: { name: 'x' },
          })
        ).statusCode,
      ).toBe(200);

      const headers = shareHeaders(l1.token, g1);
      const codes: number[] = [];
      for (let i = 0; i < 3; i += 1) {
        codes.push(
          (
            await limited.app.inject({
              method: 'POST',
              url: `/versions/${v}/threads`,
              headers,
              payload: threadBody(`c${i}`),
            })
          ).statusCode,
        );
      }
      expect(codes).toEqual([201, 201, 429]);

      const opens: number[] = [];
      for (let i = 0; i < 4; i += 1)
        opens.push(
          (await limited.app.inject({ method: 'GET', url: `/share/${l2.token}` })).statusCode,
        );
      expect(opens).toEqual([200, 200, 200, 429]);
    } finally {
      await limited.close();
    }
  });
});
