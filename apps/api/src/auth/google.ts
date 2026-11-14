import { createHash } from 'node:crypto';
import type { GoogleConfig } from '../config.js';

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  nonce: string | null;
}

export interface GoogleOAuth {
  authorizeUrl(p: {
    state: string;
    nonce: string;
    codeChallenge: string;
    redirectUri: string;
  }): string;
  exchangeCode(p: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<GoogleIdentity>;
}

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

/** PKCE S256：base64url(sha256(verifier))。 */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

export class GoogleOAuthClient implements GoogleOAuth {
  constructor(
    private readonly cfg: GoogleConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  authorizeUrl(p: {
    state: string;
    nonce: string;
    codeChallenge: string;
    redirectUri: string;
  }): string {
    const q = new URLSearchParams({
      client_id: this.cfg.clientId,
      redirect_uri: p.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state: p.state,
      nonce: p.nonce,
      code_challenge: p.codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
    return `${AUTH_ENDPOINT}?${q.toString()}`;
  }

  async exchangeCode(p: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<GoogleIdentity> {
    const res = await this.fetchImpl(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: p.code,
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        redirect_uri: p.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: p.codeVerifier,
      }).toString(),
    });
    if (!res.ok) throw new Error(`google token endpoint returned ${res.status}`);
    const body = (await res.json()) as { id_token?: unknown };
    if (typeof body.id_token !== 'string') throw new Error('google response missing id_token');

    // OIDC Core 3.1.3.7：id_token 是經 TLS 直接從 token endpoint 取得，
    // 可用 TLS 伺服器驗證取代簽章驗證，所以這裡只 decode payload，不驗簽。
    const part = body.id_token.split('.')[1];
    if (!part) throw new Error('malformed id_token');
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<
        string,
        unknown
      >;
    } catch {
      throw new Error('malformed id_token payload');
    }

    if (typeof payload.iss !== 'string' || !ISSUERS.has(payload.iss)) {
      throw new Error('id_token iss mismatch');
    }
    if (payload.aud !== this.cfg.clientId) throw new Error('id_token aud mismatch');
    if (typeof payload.exp !== 'number' || payload.exp * 1000 <= this.now().getTime()) {
      throw new Error('id_token expired');
    }
    const sub = str(payload.sub);
    const email = str(payload.email);
    if (!sub || !email) throw new Error('id_token missing sub/email');

    return {
      sub,
      email: email.toLowerCase(),
      emailVerified: payload.email_verified === true,
      name: typeof payload.name === 'string' ? payload.name : null,
      nonce: typeof payload.nonce === 'string' ? payload.nonce : null,
    };
  }
}
