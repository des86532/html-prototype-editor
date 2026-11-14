import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** monorepo 根目錄（apps/api/src/config.ts → ../../..）。相對路徑的環境變數以此為基準。 */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
}

export interface S3Config {
  endpoint?: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  region: string;
}

export interface RateLimitRule {
  /** 容量（可連續放行的次數） */
  capacity: number;
  /** 每秒補充的 token 數 */
  refillPerSecond: number;
}

export type RateLimitName =
  'authRequest' | 'shareOpen' | 'guestIdentity' | 'commentWrite' | 'cspReport';

export type RateLimitConfig = Record<RateLimitName, RateLimitRule>;

export const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  authRequest: { capacity: 10, refillPerSecond: 10 / 60 },
  shareOpen: { capacity: 60, refillPerSecond: 1 },
  guestIdentity: { capacity: 10, refillPerSecond: 10 / 60 },
  commentWrite: { capacity: 30, refillPerSecond: 0.5 },
  cspReport: { capacity: 100, refillPerSecond: 5 },
};

/** `RATE_LIMIT_SCALE`：把所有限流的容量與補充速度同乘一個倍數（e2e／壓力測試用；預設 1）。 */
export function scaleRateLimits(base: RateLimitConfig, scale: number): RateLimitConfig {
  if (!Number.isFinite(scale) || scale <= 0) throw new Error(`invalid RATE_LIMIT_SCALE: ${scale}`);
  if (scale === 1) return base;
  return Object.fromEntries(
    Object.entries(base).map(([k, r]) => [
      k,
      { capacity: Math.ceil(r.capacity * scale), refillPerSecond: r.refillPerSecond * scale },
    ]),
  ) as RateLimitConfig;
}

export interface Config {
  appOrigin: string;
  apiOrigin: string;
  apiPort: number;
  databaseUrl: string;
  storageDriver: 'fs' | 's3';
  storageFsRoot: string;
  s3: S3Config;
  sessionSecret: string;
  google: GoogleConfig | null;
  /** 開發／e2e 用的 POST /auth/dev-login；production 禁止 */
  devLogin: boolean;
  internalToken: string;
  secureCookies: boolean;
  trustProxy: boolean;
  rateLimits: RateLimitConfig;
  /** 單檔 HTML 匯出用的 shell（export-viewer 建置產物） */
  exportShellPath: string;
  /** frame-agent 建置產物（嵌入單檔匯出） */
  agentBundlePath: string;
}

type Env = Record<string, string | undefined>;

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

function resolveFromRoot(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(REPO_ROOT, p);
}

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

/** 讀取並驗證環境變數。缺少必要設定時丟出帶說明的錯誤（啟動即失敗，不要帶病執行）。 */
export function loadConfig(env: Env = process.env): Config {
  const appOrigin = stripTrailingSlash(env.APP_ORIGIN ?? 'http://localhost:5173');
  const apiPort = Number(env.API_PORT ?? 5175);
  const apiOrigin = stripTrailingSlash(env.API_ORIGIN ?? `http://localhost:${apiPort}`);
  const production = env.NODE_ENV === 'production';

  const sessionSecret = env.SESSION_SECRET ?? '';
  if (sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET 必須至少 32 個字元');
  }

  const devLogin = bool(env.DEV_LOGIN, false);
  if (devLogin && production) {
    throw new Error('DEV_LOGIN=true 不可用於 NODE_ENV=production');
  }
  const googleClientId = env.GOOGLE_CLIENT_ID ?? '';
  const googleClientSecret = env.GOOGLE_CLIENT_SECRET ?? '';
  if (Boolean(googleClientId) !== Boolean(googleClientSecret)) {
    throw new Error('必須同時設定 GOOGLE_CLIENT_ID 與 GOOGLE_CLIENT_SECRET');
  }
  const google: GoogleConfig | null = googleClientId
    ? { clientId: googleClientId, clientSecret: googleClientSecret }
    : null;
  if (!google && !devLogin) {
    throw new Error('DEV_LOGIN=false 時必須設定 GOOGLE_CLIENT_ID 與 GOOGLE_CLIENT_SECRET');
  }

  let internalToken = env.INTERNAL_TOKEN ?? '';
  if (!internalToken) {
    if (production) throw new Error('INTERNAL_TOKEN 為必要設定（content server 與 API 共用）');
    internalToken = 'dev-internal-token';
  }

  const storageDriver = env.STORAGE_DRIVER === 's3' ? 's3' : 'fs';
  const root = env.STORAGE_FS_ROOT ?? '.data/storage';

  return {
    appOrigin,
    apiOrigin,
    apiPort,
    databaseUrl: env.DATABASE_URL ?? 'postgres://localhost:5432/hpe_dev',
    storageDriver,
    storageFsRoot: path.isAbsolute(root) ? root : path.resolve(REPO_ROOT, root),
    s3: {
      ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
      bucket: env.S3_BUCKET ?? 'hpe',
      accessKey: env.S3_ACCESS_KEY ?? '',
      secretKey: env.S3_SECRET_KEY ?? '',
      region: env.S3_REGION ?? 'us-east-1',
    },
    sessionSecret,
    google,
    devLogin,
    internalToken,
    secureCookies: appOrigin.startsWith('https://'),
    trustProxy: bool(env.TRUST_PROXY, false),
    rateLimits: scaleRateLimits(DEFAULT_RATE_LIMITS, Number(env.RATE_LIMIT_SCALE ?? 1)),
    exportShellPath: resolveFromRoot(
      env.EXPORT_SHELL_PATH ?? 'packages/export-viewer/dist/index.html',
    ),
    agentBundlePath: resolveFromRoot(
      env.AGENT_BUNDLE_PATH ?? 'packages/frame-agent/dist/agent.v1.js',
    ),
  };
}
