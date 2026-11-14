/**
 * Cloudflare Pages Function：把 `https://<pages 網域>/api/*` 反向代理到後端（BACKEND_ORIGIN）。
 *
 * 為什麼要代理：Pages（pages.dev）與後端不同站，SameSite=Lax 的 session cookie 在跨站 fetch 不會送出。
 * 經過代理後瀏覽器只看到 pages.dev，cookie 變成第一方，Google 登入的 OAuth 往返也在同一個 origin。
 *
 * 部署：`wrangler pages deploy` 在 apps/web 目錄執行時會自動打包本目錄（見根目錄 package.json 的 deploy:web）。
 * 環境變數 BACKEND_ORIGIN（例如 https://api.nail-it-tech.cc）在 Pages 專案設定。
 */

export interface ProxyEnv {
  BACKEND_ORIGIN?: string;
}

const API_PREFIX = '/api';

/** 這些路徑只給 content server 內部使用（共用 token 保護），不經公開代理轉發。 */
const BLOCKED_PREFIXES = ['/internal'];

const HOP_BY_HOP = ['host', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade'];

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { code: 'BAD_GATEWAY', message } }), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export async function proxyToBackend(
  request: Request,
  backendOrigin: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  if (!backendOrigin) return jsonError(502, '尚未設定 BACKEND_ORIGIN');
  let backend: URL;
  try {
    backend = new URL(backendOrigin);
  } catch {
    return jsonError(502, 'BACKEND_ORIGIN 格式不正確');
  }

  const incoming = new URL(request.url);
  const path = incoming.pathname.slice(API_PREFIX.length) || '/';
  if (BLOCKED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
    return jsonError(404, 'Not found');
  }

  // 只設定 pathname/search，不用字串拼接：避免 `//evil.example` 這類路徑改變目標主機
  const target = new URL(backend.origin);
  target.pathname = path;
  target.search = incoming.search;

  const headers = new Headers(request.headers);
  for (const h of HOP_BY_HOP) headers.delete(h);
  const clientIp = request.headers.get('cf-connecting-ip');
  if (clientIp) headers.set('x-forwarded-for', clientIp);
  headers.set('x-forwarded-proto', 'https');

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  let upstream: Response;
  try {
    upstream = await fetchImpl(target, {
      method: request.method,
      headers,
      body: hasBody ? request.body : null,
      // 302（OAuth 導向 Google、登入後導回 app）要原樣交給瀏覽器，不能在代理端跟隨
      redirect: 'manual',
      // @ts-expect-error duplex 只有串流 request body 才需要，lib.dom 型別尚未收錄
      duplex: hasBody ? 'half' : undefined,
    });
  } catch {
    return jsonError(502, '無法連線到後端');
  }
  return new Response(upstream.body, upstream);
}

export const onRequest = (context: { request: Request; env: ProxyEnv }): Promise<Response> =>
  proxyToBackend(context.request, context.env.BACKEND_ORIGIN);
