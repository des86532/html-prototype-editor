import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { pipeline } from 'node:stream';
import { AGENT_PATH, type AssetManifestEntry } from '@hpe/shared';
import {
  assetHeaders,
  documentHeaders,
  errorHeaders,
  sanitizeOrigins,
  type HeaderMap,
  type HeaderOptions,
} from './headers.js';
import { AgentInjector } from './injectAgent.js';
import { contentTypeFor, isDocumentPath, isHtmlPath } from './mime.js';
import { normalizeRequestPath } from './paths.js';
import { contentKeyFromHost } from './resolveVersion.js';
import { BlobNotFoundError, type ResolvedVersion, type Resolver } from './resolver.js';

export interface ContentServerOptions {
  resolver: Resolver;
  /** 建置好的 frame-agent（packages/frame-agent/dist/agent.v1.js） */
  agentBundlePath: string;
  /** `CONTENT_BASE_DOMAIN`，例如 `content.localhost:5174` 或 `protousercontent.net` */
  baseDomain: string;
  /** `APP_ORIGIN`：CSP `frame-ancestors` 唯一允許的 origin */
  appOrigin: string;
  /** CSP 報告端點（例如 `${API_ORIGIN}/csp-report`） */
  cspReportUrl?: string;
  log?: (msg: string, err?: unknown) => void;
}

const AGENT_RESERVED_PREFIX = '__hpe/';
const AGENT_BUNDLE_PATH = AGENT_PATH.replace(/^\//, '');

function send(res: ServerResponse, status: number, headers: HeaderMap, body?: Buffer | string) {
  res.writeHead(status, headers);
  res.end(body);
}

const notFound = (res: ServerResponse) => send(res, 404, errorHeaders());

/** 每個 ResolvedVersion 物件只建一次 path → entry 的索引。 */
const indexCache = new WeakMap<ResolvedVersion, Map<string, AssetManifestEntry>>();
function assetIndex(v: ResolvedVersion): Map<string, AssetManifestEntry> {
  let idx = indexCache.get(v);
  if (!idx) {
    idx = new Map(v.assets.map((a) => [a.path.normalize('NFC'), a]));
    indexCache.set(v, idx);
  }
  return idx;
}

export function createContentServer(opts: ContentServerOptions): Server {
  const log = opts.log ?? (() => {});
  const cspReportUrl = opts.cspReportUrl;
  if (cspReportUrl !== undefined && /["\r\n]/.test(cspReportUrl))
    throw new Error('invalid cspReportUrl');
  if (sanitizeOrigins([opts.appOrigin]).length === 0)
    throw new Error(`invalid appOrigin: ${opts.appOrigin}`);
  const headerOpts: HeaderOptions = { appOrigin: opts.appOrigin, cspReportUrl };

  let agentCache: { mtimeMs: number; body: Buffer; etag: string } | null = null;
  async function loadAgent() {
    const st = await stat(opts.agentBundlePath);
    if (!agentCache || agentCache.mtimeMs !== st.mtimeMs) {
      const body = await readFile(opts.agentBundlePath);
      const etag = `"${createHash('sha256').update(body).digest('base64url').slice(0, 22)}"`;
      agentCache = { mtimeMs: st.mtimeMs, body, etag };
    }
    return agentCache;
  }

  async function serveAgent(req: IncomingMessage, res: ServerResponse) {
    const agent = await loadAgent();
    // 不能長快取：contentKey 輪替語意下，agent 版本更新要立即生效 → no-cache + ETag 重新驗證。
    const headers: HeaderMap = {
      ...assetHeaders('text/javascript; charset=utf-8', headerOpts),
      'Cache-Control': 'no-cache',
      ETag: agent.etag,
    };
    if (req.headers['if-none-match'] === agent.etag) return send(res, 304, headers);
    headers['Content-Length'] = String(agent.body.length);
    send(res, 200, headers, req.method === 'HEAD' ? undefined : agent.body);
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    if (req.method !== 'GET' && req.method !== 'HEAD')
      return send(res, 405, { ...errorHeaders(), Allow: 'GET, HEAD' });

    const hostHeader = req.headers.host;
    const key = contentKeyFromHost(hostHeader, opts.baseDomain);
    if (!key) return notFound(res);
    const norm = normalizeRequestPath(req.url ?? '/');
    if (!norm) return notFound(res);

    // key 與 baseDomain 都已驗證，可以安全地組成 origin
    const selfOrigin = `${/localhost|127\.0\.0\.1/.test(opts.baseDomain) ? 'http' : 'https'}://${key}.${opts.baseDomain}`;
    const version = await opts.resolver.resolve(key);
    if (!version) return notFound(res);

    if (norm.path.startsWith(AGENT_RESERVED_PREFIX) || norm.path === '__hpe') {
      return norm.path === AGENT_BUNDLE_PATH ? serveAgent(req, res) : notFound(res);
    }

    const index = assetIndex(version);
    let path = norm.path;
    if (norm.isDir) {
      path = norm.path === '' ? version.entryPage.normalize('NFC') : `${norm.path}/index.html`;
    }
    const entry = index.get(path);
    const contentType = entry ? contentTypeFor(path) : null;
    if (!entry || !contentType) return notFound(res);

    const isDoc = isDocumentPath(path);
    const headers = isDoc
      ? documentHeaders(contentType, version.cdnAllowlist, headerOpts, selfOrigin)
      : assetHeaders(contentType, headerOpts);

    if (req.method === 'HEAD') return send(res, 200, headers);

    const source = await opts.resolver.openAsset(entry.sha256);
    // HTML 會被改寫，長度未知 → chunked；其他檔案維持原樣串流。
    res.writeHead(200, headers);
    const done = (err: Error | null) => {
      if (err) {
        log(`stream error for ${key}/${path}`, err);
        res.destroy();
      }
    };
    if (isHtmlPath(path)) pipeline(source, new AgentInjector(path), res, done);
    else pipeline(source, res, done);
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (err instanceof BlobNotFoundError) return notFound(res);
      log('request failed', err);
      send(res, 502, errorHeaders());
    });
  });
  server.keepAliveTimeout = 5000;
  return server;
}
