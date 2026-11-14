import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * 全套 e2e 環境：API + content server + 主應用（vite preview，嚴格 CSP）。
 * 使用獨立的 port 與資料庫（hpe_e2e），避免和開發環境或其他測試互相干擾。
 */
export const ROOT = resolve(import.meta.dirname, '../..');
export const PORTS = { web: 5183, content: 5184, api: 5185 } as const;
export const ORIGINS = {
  web: `http://localhost:${PORTS.web}`,
  api: `http://localhost:${PORTS.api}`,
  contentBase: `content.localhost:${PORTS.content}`,
} as const;
export const STATE_FILE = join(tmpdir(), 'hpe-e2e-state.json');

export const E2E_ENV = {
  APP_ORIGIN: ORIGINS.web,
  API_ORIGIN: ORIGINS.api,
  API_PORT: String(PORTS.api),
  CONTENT_PORT: String(PORTS.content),
  CONTENT_BASE_DOMAIN: ORIGINS.contentBase,
  API_INTERNAL_ORIGIN: ORIGINS.api,
  INTERNAL_TOKEN: 'e2e-internal-token',
  DATABASE_URL: process.env.E2E_DATABASE_URL ?? 'postgres://localhost:5432/hpe_e2e',
  DEV_LOGIN: 'true',
  SESSION_SECRET: 'e2e-session-secret-e2e-session-secret',
  STORAGE_DRIVER: 'fs',
  NODE_ENV: 'test',
  // perf.spec 需要一次建立 200 則討論串；限流本身由 apps/api 的單元測試驗證
  RATE_LIMIT_SCALE: '20',
} as const;

export interface StackState {
  pids: number[];
  storageDir: string;
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status})`);
}

async function waitForHttp(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.status < 500) return;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timeout waiting for ${url}: ${String(lastErr)}`);
}

function start(name: string, cmd: string, args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  const prefix = `[${name}] `;
  child.stdout?.on('data', (d) => process.env.E2E_VERBOSE && process.stdout.write(prefix + d));
  child.stderr?.on('data', (d) => process.env.E2E_VERBOSE && process.stderr.write(prefix + d));
  return child;
}

export async function startStack(): Promise<StackState> {
  const storageDir = mkdtempSync(join(tmpdir(), 'hpe-e2e-storage-'));
  const env = { ...E2E_ENV, STORAGE_FS_ROOT: storageDir } as NodeJS.ProcessEnv;

  // 乾淨的資料庫：drop & recreate schema 再 migrate。
  const dbName = new URL(E2E_ENV.DATABASE_URL).pathname.slice(1);
  if (!/^hpe_e2e/.test(dbName)) throw new Error(`refusing to reset non-e2e database: ${dbName}`);
  run('psql', [
    E2E_ENV.DATABASE_URL,
    '-q',
    '-c',
    'DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;',
  ]);
  run('rm', ['-rf', join(ROOT, 'apps/web/dist-e2e')]);
  run('pnpm', ['exec', 'tsx', 'apps/api/src/db/migrate.ts'], env);

  // 建置：agent、主應用（env 會被烘進 bundle，所以輸出到 dist-e2e）。
  run('pnpm', ['--filter', '@hpe/frame-agent', 'build'], env);
  if (
    !process.env.E2E_SKIP_EXPORT_VIEWER &&
    !existsSync(join(ROOT, 'packages/export-viewer/dist/index.html'))
  ) {
    run('pnpm', ['--filter', '@hpe/export-viewer', 'build'], env);
  }
  // 主應用一律用 production 建置（NODE_ENV=test 會把 React 的開發版包進 bundle，效能數字會失真）
  run(
    'pnpm',
    ['--filter', '@hpe/web', 'exec', 'vite', 'build', '--outDir', 'dist-e2e', '--emptyOutDir'],
    { ...env, NODE_ENV: 'production' },
  );

  const procs = [
    start('api', 'pnpm', ['exec', 'tsx', 'apps/api/src/main.ts'], env),
    start('content', 'pnpm', ['exec', 'tsx', 'apps/content/src/main.ts'], env),
    start(
      'web',
      'pnpm',
      [
        '--filter',
        '@hpe/web',
        'exec',
        'vite',
        'preview',
        '--outDir',
        'dist-e2e',
        '--port',
        String(PORTS.web),
      ],
      env,
    ),
  ];
  const state: StackState = { pids: procs.map((p) => p.pid!).filter(Boolean), storageDir };
  writeFileSync(STATE_FILE, JSON.stringify(state));
  await Promise.all([
    waitForHttp(`${ORIGINS.api}/me`),
    waitForHttp(`http://127.0.0.1:${PORTS.content}/`),
    waitForHttp(`${ORIGINS.web}/`),
  ]);
  return state;
}

export function stopStack(): void {
  if (!existsSync(STATE_FILE)) return;
  const state = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as StackState;
  for (const pid of state.pids) {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
  rmSync(state.storageDir, { recursive: true, force: true });
  rmSync(STATE_FILE, { force: true });
}
