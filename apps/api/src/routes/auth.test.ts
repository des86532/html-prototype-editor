import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pkceChallenge } from '../auth/google.js';
import { sessions, users } from '../db/schema.js';
import { sha256Hex } from '../ids.js';
import { cookieOf, createHarness, type Harness } from '../testing/harness.js';

let now = new Date();
let h: Harness;
beforeAll(async () => {
  h = await createHarness({ now: () => now });
});
afterAll(() => h.close());

const alice = { sub: 'g-1', email: 'alice@example.com', emailVerified: true, name: 'Alice' };

function loc(res: { headers: Record<string, unknown> }): string {
  return String(res.headers.location);
}

describe('Google 登入', () => {
  it('成功：建立使用者、設定 HttpOnly + SameSite=Lax cookie、導回 APP_ORIGIN，session 只存 hash', async () => {
    const cb = await h.googleLogin(alice);
    expect(cb.statusCode).toBe(302);
    expect(loc(cb)).toBe('http://localhost:5173');
    const raw = ([] as string[]).concat(cb.headers['set-cookie'] as string | string[]);
    const session = raw.find((c) => c.startsWith('hpe_session='))!;
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/SameSite=Lax/i);
    expect(session).not.toMatch(/Secure/i); // APP_ORIGIN 為 http
    const cleared = cb.cookies.find((c) => c.name === 'hpe_oauth');
    expect(cleared?.value).toBe('');

    const cookie = cookieOf(cb);
    const token = cookie.split('=')[1]!;
    const rows = await h.testDb.db.select().from(sessions);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.hash).toBe(sha256Hex(token));
    expect(rows[0]!.hash).not.toBe(token);

    const me = await h.app.inject({ method: 'GET', url: '/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ user: { email: 'alice@example.com', name: 'Alice' } });

    const audit = await h.testDb.pool.query(
      "select meta from audit_log where action = 'auth.login'",
    );
    expect(audit.rows[0].meta).toEqual({ provider: 'google' });
  });

  it('同一個 sub 再登入不會新增使用者', async () => {
    await h.googleLogin({ ...alice, sub: 'g-same', email: 'same-sub@example.com' });
    await h.googleLogin({ ...alice, sub: 'g-same', email: 'same-sub@example.com' });
    const rows = await h.testDb.db
      .select()
      .from(users)
      .where(eq(users.email, 'same-sub@example.com'));
    expect(rows).toHaveLength(1);
  });

  it('既有（dev-login）使用者第一次用 Google 登入時依 email 綁定', async () => {
    await h.login('legacy@example.com');
    const [before] = await h.testDb.db
      .select()
      .from(users)
      .where(eq(users.email, 'legacy@example.com'));
    expect(before!.googleSub).toBeNull();
    const cb = await h.googleLogin({
      sub: 'g-2',
      email: 'legacy@example.com',
      emailVerified: true,
      name: 'Legacy',
    });
    expect(cb.statusCode).toBe(302);
    expect(loc(cb)).toBe('http://localhost:5173');
    const rows = await h.testDb.db
      .select()
      .from(users)
      .where(eq(users.email, 'legacy@example.com'));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(before!.id);
    expect(rows[0]!.googleSub).toBe('g-2');
  });

  it('email 已綁定其他 sub → google_conflict，不發 session', async () => {
    await h.googleLogin({ sub: 'g-3', email: 'taken@example.com', emailVerified: true, name: 'T' });
    const cb = await h.googleLogin({
      sub: 'g-3-other',
      email: 'taken@example.com',
      emailVerified: true,
      name: 'T2',
    });
    expect(cb.statusCode).toBe(302);
    expect(loc(cb)).toBe('http://localhost:5173/login?error=google_conflict');
    expect(cb.cookies.find((c) => c.name === 'hpe_session')).toBeUndefined();
  });

  it('Email 未驗證 → google_email_unverified', async () => {
    const cb = await h.googleLogin({
      ...alice,
      sub: 'g-4',
      email: 'u@example.com',
      emailVerified: false,
    });
    expect(loc(cb)).toBe('http://localhost:5173/login?error=google_email_unverified');
    expect(cb.cookies.find((c) => c.name === 'hpe_session')).toBeUndefined();
    expect(
      await h.testDb.db.select().from(users).where(eq(users.email, 'u@example.com')),
    ).toHaveLength(0);
  });

  it('nonce 不符 → google_failed', async () => {
    const cb = await h.googleLogin({
      ...alice,
      sub: 'g-5',
      email: 'n@example.com',
      nonce: 'wrong',
    });
    expect(loc(cb)).toBe('http://localhost:5173/login?error=google_failed');
    expect(cb.cookies.find((c) => c.name === 'hpe_session')).toBeUndefined();
  });

  it('state 不符、或沒帶 hpe_oauth cookie → google_state', async () => {
    const start = await h.app.inject({ method: 'GET', url: '/auth/google' });
    const oauth = start.cookies.find((c) => c.name === 'hpe_oauth')!;
    const badState = await h.app.inject({
      method: 'GET',
      url: '/auth/google/callback?code=abc&state=wrong',
      headers: { cookie: `hpe_oauth=${oauth.value}` },
    });
    expect(loc(badState)).toBe('http://localhost:5173/login?error=google_state');
    const state = new URL(loc(start)).searchParams.get('state')!;
    const noCookie = await h.app.inject({
      method: 'GET',
      url: `/auth/google/callback?code=abc&state=${state}`,
    });
    expect(loc(noCookie)).toBe('http://localhost:5173/login?error=google_state');
  });

  it('使用者在 Google 取消（?error=access_denied）→ google_denied', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/auth/google/callback?error=access_denied',
    });
    expect(loc(res)).toBe('http://localhost:5173/login?error=google_denied');
  });

  it('未知 code（token 交換失敗）→ google_failed', async () => {
    const start = await h.app.inject({ method: 'GET', url: '/auth/google' });
    const oauth = start.cookies.find((c) => c.name === 'hpe_oauth')!;
    const state = new URL(loc(start)).searchParams.get('state')!;
    const res = await h.app.inject({
      method: 'GET',
      url: `/auth/google/callback?code=unknown&state=${state}`,
      headers: { cookie: `hpe_oauth=${oauth.value}` },
    });
    expect(loc(res)).toBe('http://localhost:5173/login?error=google_failed');
  });

  it('GET /auth/google：導向 Google，code_challenge 對應 cookie 內的 verifier', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/auth/google' });
    expect(res.statusCode).toBe(302);
    const url = new URL(loc(res));
    expect(url.origin).toBe('https://accounts.example');
    const oauth = res.cookies.find((c) => c.name === 'hpe_oauth')!;
    const [state, verifier, nonce] = oauth.value.split('.');
    expect(url.searchParams.get('state')).toBe(state);
    expect(url.searchParams.get('nonce')).toBe(nonce);
    expect(url.searchParams.get('code_challenge')).toBe(pkceChallenge(verifier!));
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:5175/auth/google/callback');
    expect(oauth.path).toBe('/auth/google');
    expect(oauth.maxAge).toBe(600);
    expect(oauth.httpOnly).toBe(true);
  });

  it('API_ORIGIN 帶路徑前綴（反向代理）：redirect_uri 與 hpe_oauth 的 Path 都帶前綴', async () => {
    const proxied = await createHarness({
      config: { apiOrigin: 'https://app.example.pages.dev/api', secureCookies: true },
    });
    try {
      const res = await proxied.app.inject({ method: 'GET', url: '/auth/google' });
      const url = new URL(loc(res));
      expect(url.searchParams.get('redirect_uri')).toBe(
        'https://app.example.pages.dev/api/auth/google/callback',
      );
      const oauth = res.cookies.find((c) => c.name === 'hpe_oauth')!;
      expect(oauth.path).toBe('/api/auth/google');
    } finally {
      await proxied.close();
    }
  });

  it('DEV_LOGIN=false → POST /auth/dev-login 回 404', async () => {
    const off = await createHarness({ config: { devLogin: false } });
    try {
      const res = await off.app.inject({
        method: 'POST',
        url: '/auth/dev-login',
        payload: { email: 'a@b.co' },
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await off.close();
    }
  });

  it('未設定 Google → /auth/google 導向 google_not_configured', async () => {
    const none = await createHarness({ google: null });
    try {
      const res = await none.app.inject({ method: 'GET', url: '/auth/google' });
      expect(res.statusCode).toBe(302);
      expect(loc(res)).toBe('http://localhost:5173/login?error=google_not_configured');
    } finally {
      await none.close();
    }
  });

  it('secureCookies=true 時 session cookie 帶 Secure', async () => {
    const sec = await createHarness({ config: { secureCookies: true } });
    try {
      const cb = await sec.googleLogin({ ...alice, sub: 'g-sec', email: 'sec@example.com' });
      const raw = ([] as string[]).concat(cb.headers['set-cookie'] as string | string[]);
      expect(raw.find((c) => c.startsWith('hpe_session='))).toMatch(/Secure/i);
    } finally {
      await sec.close();
    }
  });

  it('dev-login：同一個 email 再次登入不會重複建立使用者', async () => {
    await h.login('same@example.com');
    await h.login('same@example.com');
    const rows = await h.testDb.db.select().from(users).where(eq(users.email, 'same@example.com'));
    expect(rows).toHaveLength(1);
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

  it('dev-login 寫入審計日誌', async () => {
    await h.login('audit@example.com');
    const res = await h.testDb.pool.query(
      "select meta from audit_log where action = 'auth.login' and meta->>'provider' = 'dev'",
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
      url: '/auth/dev-login',
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

  it('auth 請求頻率限制', async () => {
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
          url: '/auth/dev-login',
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
