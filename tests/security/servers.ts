import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createContentServer } from '../../apps/content/src/server.js';
import { FixtureResolver } from '../../apps/content/src/fixtureResolver.js';
import {
  APP_ORIGIN,
  CONTENT_BASE_DOMAIN,
  CONTENT_PORT,
  EVIL_PORT,
  HARNESS_PORT,
  REPO_ROOT,
  TEST_KEY,
  VECTORS_DIR,
  agentBundlePath,
} from './config.js';

const run = promisify(execFile);

export interface EvilRequest {
  at: number;
  method: string;
  url: string;
  host: string;
  dest: string;
  mode: string;
  origin: string;
}

export interface EvilServer {
  requests(): EvilRequest[];
  reset(): void;
  close(): Promise<void>;
}

/** 在 loopback 的 IPv4／IPv6 上都聽（瀏覽器把 `*.localhost` 解析成 127.0.0.1 或 ::1 都可以連到）。 */
async function listen(server: Server, port: number): Promise<void> {
  const tryListen = (host: string) =>
    new Promise<void>((ok, fail) => {
      const onError = (e: Error) => fail(e);
      server.once('error', onError);
      server.listen(port, host, () => {
        server.off('error', onError);
        ok();
      });
    });
  try {
    await tryListen('::');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EADDRINUSE') throw e;
    await tryListen('127.0.0.1');
  }
}

const close = (server: Server) =>
  new Promise<void>((ok) => {
    server.closeAllConnections();
    server.close(() => ok());
  });

/**
 * evil server：記錄「所有」請求（包含 WebSocket upgrade），並對每個請求都回 200 + `ACAO: *`，
 * 讓「沒被擋住」的外送一定看得到。`GET /__requests` 回傳 JSON 紀錄（本身不記錄）。
 */
export async function startEvilServer(): Promise<EvilServer> {
  let log: EvilRequest[] = [];
  const record = (req: IncomingMessage) => {
    const h = req.headers;
    log.push({
      at: Date.now(),
      method: req.method ?? '',
      url: req.url ?? '',
      host: String(h.host ?? ''),
      dest: String(h['sec-fetch-dest'] ?? ''),
      mode: String(h['sec-fetch-mode'] ?? ''),
      origin: String(h.origin ?? ''),
    });
  };
  const server = createServer((req, res) => {
    if (req.url === '/__requests') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(log));
      return;
    }
    record(req);
    req.resume();
    if (req.url?.startsWith('/embed-harness')) {
      // V24：evil 站嵌入主應用（clickjacking）
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        `<!doctype html><title>evil</title><iframe id="victim" src="${APP_ORIGIN}/harness.html" width="800" height="600"></iframe>`,
      );
      return;
    }
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'access-control-allow-origin': '*',
    });
    res.end('<!doctype html><title>evil</title><h1>evil</h1>');
  });
  server.on('upgrade', (req, socket) => {
    record(req);
    socket.destroy();
  });
  await listen(server, EVIL_PORT);
  return {
    // 瀏覽器自己的 favicon 探測不算 prototype 的外送。
    requests: () => log.filter((r) => r.url !== '/favicon.ico'),
    reset: () => {
      log = [];
    },
    close: () => close(server),
  };
}

function newestMtime(path: string): number {
  if (!existsSync(path)) return 0;
  const st = statSync(path);
  if (!st.isDirectory()) return st.mtimeMs;
  let newest = st.mtimeMs;
  for (const name of readdirSync(path)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    newest = Math.max(newest, newestMtime(join(path, name)));
  }
  return newest;
}

const WEB = resolve(REPO_ROOT, 'apps/web');
const HARNESS_DIST = join(WEB, 'dist-harness/harness.html');
const viteBin = join(WEB, 'node_modules/vite/bin/vite.js');
const tsxBin = join(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs');

/** 重新建置 frame-agent（很快），並在 harness 來源比 dist 新時重建 harness。 */
async function ensureBuilt(): Promise<void> {
  await run(process.execPath, [tsxBin, 'build.ts'], {
    cwd: join(REPO_ROOT, 'packages/frame-agent'),
  });
  const sources = [
    join(WEB, 'harness.html'),
    join(WEB, 'vite.harness.config.ts'),
    join(WEB, 'csp.ts'),
    join(WEB, 'src/harness'),
    join(WEB, 'src/features/viewer'),
    join(WEB, 'src/styles.css'),
    join(REPO_ROOT, 'packages/shared/src'),
  ];
  const stale =
    !existsSync(HARNESS_DIST) ||
    Math.max(...sources.map(newestMtime)) > statSync(HARNESS_DIST).mtimeMs;
  if (stale) {
    await run(process.execPath, [viteBin, 'build', '--config', 'vite.harness.config.ts'], {
      cwd: WEB,
      env: { ...process.env, VITE_CONFIG_NATIVE_IGNORE_WARNING: 'true' },
    });
  }
}

async function waitForHttp(url: string, child: ChildProcess, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`harness preview exited with code ${child.exitCode}`);
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not ready */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timed out waiting for ${url}`);
}

export interface Servers {
  evil: EvilServer;
  content: Server;
  resolver: FixtureResolver;
  stop(): Promise<void>;
}

export async function startServers(): Promise<Servers> {
  await ensureBuilt();
  const evil = await startEvilServer();

  const resolver = new FixtureResolver({ [TEST_KEY]: { dir: VECTORS_DIR } });
  const content = createContentServer({
    resolver,
    agentBundlePath,
    baseDomain: CONTENT_BASE_DOMAIN,
    appOrigin: APP_ORIGIN,
    cspReportUrl: 'http://localhost:5175/csp-report',
    log: (m, e) => console.error('[content]', m, e),
  });
  await listen(content, CONTENT_PORT);

  const preview = spawn(
    process.execPath,
    [viteBin, 'preview', '--config', 'vite.harness.config.ts'],
    {
      cwd: WEB,
      env: {
        ...process.env,
        CONTENT_BASE_DOMAIN,
        HARNESS_PORT: String(HARNESS_PORT),
        VITE_CONFIG_NATIVE_IGNORE_WARNING: 'true',
      },
      stdio: ['ignore', 'ignore', 'inherit'],
    },
  );
  const killPreview = () => preview.kill();
  process.once('exit', killPreview);
  try {
    await waitForHttp(`${APP_ORIGIN}/harness.html`, preview, 30_000);
  } catch (e) {
    preview.kill();
    await evil.close();
    await close(content);
    throw e;
  }

  return {
    evil,
    content,
    resolver,
    async stop() {
      process.off('exit', killPreview);
      preview.kill();
      await Promise.all([evil.close(), close(content)]);
    },
  };
}
