import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authTokens, sessions, users } from '../db/schema.js';
import { sha256Hex } from '../ids.js';
import { cookieOf, createHarness, type Harness } from '../testing/harness.js';

let now = new Date();
let h: Harness;
beforeAll(async () => {
  h = await createHarness({ now: () => now });
});
afterAll(() => h.close());

async function requestLink(email: string): Promise<string> {
  const res = await h.app.inject({ method: 'POST', url: '/auth/magic-link', payload: { email } });
  expect(res.statusCode).toBe(200);
  const link = new URL((res.json() as { devLink: string }).devLink);
  return link.pathname + link.search;
}

describe('magic link 登入', () => {
  it('callback：建立使用者、設定 HttpOnly + SameSite=Lax cookie、導回 APP_ORIGIN，session 只存 hash', async () => {
    const url = await requestLink('Alice@Example.com');
    const cb = await h.app.inject({ method: 'GET', url });
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toBe('http://localhost:5173');
    const raw = String(cb.headers['set-cookie']);
    expect(raw).toMatch(/hpe_session=/);
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Lax/i);
    expect(raw).not.toMatch(/Secure/i); // APP_ORIGIN 為 http

    const cookie = cookieOf(cb);
    const token = cookie.split('=')[1]!;
    const rows = await h.testDb.db.select().from(sessions);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.hash).toBe(sha256Hex(token));
    expect(rows[0]!.hash).not.toBe(token);

    const me = await h.app.inject({ method: 'GET', url: '/me', headers: { cookie } });
    expect(me.json()).toMatchObject({ user: { email: 'alice@example.com', name: 'alice' } });
  });

  it('連結只能使用一次', async () => {
    const url = await requestLink('once@example.com');
    expect((await h.app.inject({ method: 'GET', url })).statusCode).toBe(302);
    const again = await h.app.inject({ method: 'GET', url });
    expect(again.statusCode).toBe(400);
    expect(again.json()).toMatchObject({ error: { code: 'BAD_REQUEST' } });
  });

  it('15 分鐘後過期', async () => {
    const url = await requestLink('late@example.com');
    const base = now;
    now = new Date(base.getTime() + 15 * 60 * 1000 + 1000);
    const res = await h.app.inject({ method: 'GET', url });
    now = base;
    expect(res.statusCode).toBe(400);
    const [tok] = await h.testDb.db
      .select()
      .from(authTokens)
      .where(eq(authTokens.email, 'late@example.com'));
    expect(tok!.usedAt).toBeNull();
  });

  it('同一個 email 再次登入不會重複建立使用者', async () => {
    await h.login('same@example.com');
    await h.login('same@example.com');
    const rows = await h.testDb.db.select().from(users).where(eq(users.email, 'same@example.com'));
    expect(rows).toHaveLength(1);
  });

  it('隨機 token 與格式錯誤都回 400', async () => {
    expect(
      (await h.app.inject({ method: 'GET', url: '/auth/callback?token=' + 'x'.repeat(43) }))
        .statusCode,
    ).toBe(400);
    expect((await h.app.inject({ method: 'GET', url: '/auth/callback' })).statusCode).toBe(400);
  });

  it('logout 讓 session 失效', async () => {
    const cookie = await h.login('bye@example.com');
    expect(
      (await h.app.inject({ method: 'GET', url: '/me', headers: { cookie } })).statusCode,
    ).toBe(200);
    const out = await h.app.inject({ method: 'POST', url: '/auth/logout', headers: { cookie } });
    expect(out.statusCode).toBe(200);
    expect(
      (await h.app.inject({ method: 'GET', url: '/me', headers: { cookie } })).statusCode,
    ).toBe(401);
  });

  it('session 過期後失效', async () => {
    const cookie = await h.login('expire@example.com');
    const base = now;
    now = new Date(base.getTime() + 31 * 24 * 3600 * 1000);
    const res = await h.app.inject({ method: 'GET', url: '/me', headers: { cookie } });
    now = base;
    expect(res.statusCode).toBe(401);
  });

  it('登入寫入審計日誌', async () => {
    await h.login('audit@example.com');
    const res = await h.testDb.pool.query(
      "select action from audit_log where action = 'auth.login'",
    );
    expect(res.rowCount).toBeGreaterThan(0);
  });
});

describe('錯誤格式', () => {
  it('未登入 → 401 { error: { code, message } }', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: { code: 'UNAUTHENTICATED', message: '請先登入' } });
  });

  it('未知路由與驗證錯誤都使用同一種格式', async () => {
    const nf = await h.app.inject({ method: 'GET', url: '/nope' });
    expect(nf.statusCode).toBe(404);
    expect(nf.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    const bad = await h.app.inject({
      method: 'POST',
      url: '/auth/magic-link',
      payload: { email: 'not-an-email' },
    });
    expect(bad.statusCode).toBe(400);
    const j = bad.json() as { error: { code: string; details: { issues: unknown[] } } };
    expect(j.error.code).toBe('BAD_REQUEST');
    expect(j.error.details.issues.length).toBeGreaterThan(0);
  });

  it('安全標頭與 CORS（只允許 APP_ORIGIN，帶 credentials）', async () => {
    const res = await h.app.inject({
      method: 'OPTIONS',
      url: '/projects',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-share-token,x-guest-token',
      },
    });
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(String(res.headers['access-control-allow-headers'])).toContain('x-guest-token');
    const evil = await h.app.inject({
      method: 'OPTIONS',
      url: '/projects',
      headers: { origin: 'http://evil.example', 'access-control-request-method': 'POST' },
    });
    expect(evil.headers['access-control-allow-origin']).not.toBe('http://evil.example');
    const me = await h.app.inject({ method: 'GET', url: '/me' });
    expect(me.headers['x-content-type-options']).toBe('nosniff');
    expect(me.headers['cache-control']).toBe('no-store');
  });

  it('magic-link 請求頻率限制', async () => {
    const limited = await createHarness({
      config: {
        rateLimits: {
          authRequest: { capacity: 2, refillPerSecond: 0.001 },
          shareOpen: { capacity: 100, refillPerSecond: 100 },
          guestIdentity: { capacity: 100, refillPerSecond: 100 },
          commentWrite: { capacity: 100, refillPerSecond: 100 },
          cspReport: { capacity: 100, refillPerSecond: 100 },
        },
      },
    });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 3; i += 1) {
        const r = await limited.app.inject({
          method: 'POST',
          url: '/auth/magic-link',
          payload: { email: 'a@b.co' },
        });
        codes.push(r.statusCode);
        if (i === 2) {
          expect(r.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
          expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
        }
      }
      expect(codes).toEqual([200, 200, 429]);
    } finally {
      await limited.close();
    }
  });
});

describe('正式模式（寄信）', () => {
  it('DEV_MAGIC_LINK=false：寄出連結、回應不含 devLink、不洩漏帳號是否存在', async () => {
    const prod = await createHarness({ config: { devMagicLink: false, secureCookies: true } });
    try {
      const res = await prod.app.inject({
        method: 'POST',
        url: '/auth/magic-link',
        payload: { email: 'Real@Example.com' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
      expect(prod.mailer.sent).toHaveLength(1);
      expect(prod.mailer.sent[0]!.email).toBe('real@example.com');
      const link = new URL(prod.mailer.sent[0]!.link);
      const cb = await prod.app.inject({ method: 'GET', url: link.pathname + link.search });
      expect(String(cb.headers['set-cookie'])).toMatch(/Secure/i);
      expect(String(cb.headers['set-cookie'])).toMatch(/HttpOnly/i);
    } finally {
      await prod.close();
    }
  });
});
