import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** monorepo 根目錄（apps/api/src/config.ts → ../../..）。相對路徑的環境變數以此為基準。 */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
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

export interface Config {
  appOrigin: string;
  apiOrigin: string;
  apiPort: number;
  databaseUrl: string;
  storageDriver: 'fs' | 's3';
  storageFsRoot: string;
  s3: S3Config;
  sessionSecret: string;
  devMagicLink: boolean;
  smtp: SmtpConfig | null;
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

  const devMagicLink = bool(env.DEV_MAGIC_LINK, false);
  if (devMagicLink && production) {
    throw new Error('DEV_MAGIC_LINK=true 不可用於 NODE_ENV=production');
  }
  let smtp: SmtpConfig | null = null;
  if (env.SMTP_HOST) {
    const port = Number(env.SMTP_PORT ?? 587);
    smtp = {
      host: env.SMTP_HOST,
      port,
      secure: bool(env.SMTP_SECURE, port === 465),
      ...(env.SMTP_USER ? { user: env.SMTP_USER } : {}),
      ...(env.SMTP_PASS ? { pass: env.SMTP_PASS } : {}),
      from: env.SMTP_FROM ?? 'HTML Prototype Editor <no-reply@localhost>',
    };
  }
  if (!devMagicLink && !smtp) {
    throw new Error(
      'DEV_MAGIC_LINK=false 時必須設定 SMTP_HOST（及 SMTP_PORT/SMTP_USER/SMTP_PASS）',
    );
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
    devMagicLink,
    smtp,
    internalToken,
    secureCookies: appOrigin.startsWith('https://'),
    trustProxy: bool(env.TRUST_PROXY, false),
    rateLimits: DEFAULT_RATE_LIMITS,
    exportShellPath: resolveFromRoot(
      env.EXPORT_SHELL_PATH ?? 'packages/export-viewer/dist/index.html',
    ),
    agentBundlePath: resolveFromRoot(
      env.AGENT_BUNDLE_PATH ?? 'packages/frame-agent/dist/agent.v1.js',
    ),
  };
}
