import { describe, expect, it } from 'vitest';
import { GoogleOAuthClient, pkceChallenge } from './google.js';

const cfg = { clientId: 'cid', clientSecret: 'secret' };
const NOW = new Date('2025-01-01T00:00:00Z');
const nowSec = NOW.getTime() / 1000;

function idToken(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'RS256' })}.${b64(payload)}.sig`;
}

const validPayload = {
  iss: 'https://accounts.google.com',
  aud: 'cid',
  exp: nowSec + 3600,
  sub: 'sub-1',
  email: 'Alice@Example.COM',
  email_verified: true,
  name: 'Alice',
  nonce: 'n-1',
};

function client(respond: () => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond();
  }) as unknown as typeof fetch;
  return { calls, c: new GoogleOAuthClient(cfg, fetchImpl, () => NOW) };
}

const ok = (payload: Record<string, unknown>) => () =>
  new Response(JSON.stringify({ id_token: idToken(payload) }), { status: 200 });
const params = { code: 'c', codeVerifier: 'v', redirectUri: 'http://localhost:5175/cb' };

describe('GoogleOAuthClient.exchangeCode', () => {
  it('合法 token：email 轉小寫，emailVerified 與 nonce 正確，並送出 PKCE 參數', async () => {
    const { c, calls } = client(ok(validPayload));
    await expect(c.exchangeCode(params)).resolves.toEqual({
      sub: 'sub-1',
      email: 'alice@example.com',
      emailVerified: true,
      name: 'Alice',
      nonce: 'n-1',
    });
    expect(calls[0]!.url).toBe('https://oauth2.googleapis.com/token');
    const body = new URLSearchParams(String(calls[0]!.init.body));
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code_verifier')).toBe('v');
    expect(body.get('code')).toBe('c');
    expect(body.get('client_secret')).toBe('secret');
    expect(body.get('redirect_uri')).toBe(params.redirectUri);
  });

  it('email_verified 不是 true → emailVerified=false', async () => {
    const { c } = client(ok({ ...validPayload, email_verified: 'true' }));
    expect((await c.exchangeCode(params)).emailVerified).toBe(false);
  });

  it.each([
    ['aud 不符', { aud: 'other' }],
    ['exp 已過', { exp: nowSec - 1 }],
    ['iss 不是 Google', { iss: 'https://evil.example' }],
    ['缺 sub', { sub: '' }],
  ])('%s → reject', async (_n, over) => {
    const { c } = client(ok({ ...validPayload, ...over }));
    await expect(c.exchangeCode(params)).rejects.toThrow();
  });

  it('token endpoint 回 400 → reject', async () => {
    const { c } = client(() => new Response('{"error":"invalid_grant"}', { status: 400 }));
    await expect(c.exchangeCode(params)).rejects.toThrow();
  });

  it('回應沒有 id_token → reject', async () => {
    const { c } = client(() => new Response('{}', { status: 200 }));
    await expect(c.exchangeCode(params)).rejects.toThrow();
  });
});

describe('GoogleOAuthClient.authorizeUrl', () => {
  it('帶 PKCE S256、nonce、state', () => {
    const url = new URL(
      new GoogleOAuthClient(cfg).authorizeUrl({
        state: 's',
        nonce: 'n',
        codeChallenge: pkceChallenge('verifier'),
        redirectUri: 'http://localhost:5175/cb',
      }),
    );
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('state')).toBe('s');
    expect(url.searchParams.get('nonce')).toBe('n');
  });
});
