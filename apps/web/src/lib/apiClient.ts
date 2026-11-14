import {
  API_HEADERS,
  API_ROUTES,
  buildPath,
  type ApiErrorBody,
  type ApiRouteName,
  type ErrorCode,
} from '@hpe/shared';

/** 非 API 契約內的網路／格式錯誤使用的代碼。 */
export type ClientErrorCode = ErrorCode | 'NETWORK' | 'BAD_RESPONSE';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ClientErrorCode;
  readonly details?: unknown;
  constructor(status: number, code: ClientErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

export interface RequestOptions {
  params?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** JSON body */
  json?: unknown;
  /** multipart body（檔案上傳）；與 json 擇一 */
  form?: FormData;
  signal?: AbortSignal;
  /** 寫入評論時需要 guest token；預設依 route 判斷 */
  headers?: Record<string, string>;
}

export interface ApiClientConfig {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  getShareToken?: () => string | null;
  getGuestToken?: (shareToken: string) => string | null;
}

export interface DownloadResult {
  blob: Blob;
  filename: string | null;
}

/** 解析 `Content-Disposition` 的 filename（優先 RFC 5987 的 filename*）。 */
export function parseContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/i.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      /* fall through */
    }
  }
  const quoted = /filename\s*=\s*"((?:[^"\\]|\\.)*)"/i.exec(header);
  if (quoted?.[1]) return quoted[1].replace(/\\(.)/g, '$1');
  const plain = /filename\s*=\s*([^;]+)/i.exec(header);
  return plain?.[1] ? plain[1].trim() : null;
}

export class ApiClient {
  private readonly cfg: ApiClientConfig;
  constructor(cfg: ApiClientConfig) {
    this.cfg = cfg;
  }

  private url(route: ApiRouteName, opts: RequestOptions): string {
    const path = buildPath(route, opts.params);
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined && v !== null) qs.set(k, String(v));
    }
    const q = qs.toString();
    return `${this.cfg.baseUrl.replace(/\/+$/, '')}${path}${q ? `?${q}` : ''}`;
  }

  private init(route: ApiRouteName, opts: RequestOptions): RequestInit {
    const headers: Record<string, string> = { accept: 'application/json', ...opts.headers };
    const shareToken = this.cfg.getShareToken?.() ?? null;
    if (shareToken) {
      headers[API_HEADERS.shareToken] = shareToken;
      const guest = this.cfg.getGuestToken?.(shareToken) ?? null;
      if (guest) headers[API_HEADERS.guestToken] = guest;
    }
    let body: BodyInit | undefined;
    if (opts.form) {
      body = opts.form; // 讓瀏覽器自行設定 multipart boundary
    } else if (opts.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(opts.json);
    }
    return {
      method: API_ROUTES[route].method,
      credentials: 'include',
      headers,
      body,
      signal: opts.signal,
    };
  }

  private async send(route: ApiRouteName, opts: RequestOptions): Promise<Response> {
    const f = this.cfg.fetchImpl ?? fetch;
    let res: Response;
    try {
      res = await f(this.url(route, opts), this.init(route, opts));
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      throw new ApiError(0, 'NETWORK', '無法連線到伺服器');
    }
    if (res.ok) return res;
    let body: { error?: ApiErrorBody } | null = null;
    try {
      body = (await res.json()) as { error?: ApiErrorBody };
    } catch {
      body = null;
    }
    const err = body?.error;
    if (err && typeof err.code === 'string') {
      throw new ApiError(res.status, err.code, err.message ?? err.code, err.details);
    }
    throw new ApiError(res.status, res.status >= 500 ? 'INTERNAL' : 'BAD_REQUEST', res.statusText);
  }

  async request<T>(route: ApiRouteName, opts: RequestOptions = {}): Promise<T> {
    const res = await this.send(route, opts);
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ApiError(res.status, 'BAD_RESPONSE', '伺服器回應格式錯誤');
    }
  }

  async download(route: ApiRouteName, opts: RequestOptions = {}): Promise<DownloadResult> {
    const res = await this.send(route, opts);
    return {
      blob: await res.blob(),
      filename: parseContentDisposition(res.headers.get('content-disposition')),
    };
  }
}

/* ---------------- 分享 session（token 只放記憶體 + sessionStorage；guestToken 放 localStorage） ---------------- */

const SHARE_KEY = 'hpe.shareToken';
const GUEST_PREFIX = 'hpe.guestToken.';

let shareTokenMem: string | null = null;
let shareLoaded = false;

function safeStorage(kind: 'session' | 'local'): Storage | null {
  try {
    return kind === 'session' ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

export function getShareToken(): string | null {
  if (!shareLoaded) {
    shareLoaded = true;
    shareTokenMem = safeStorage('session')?.getItem(SHARE_KEY) ?? null;
  }
  return shareTokenMem;
}

export function setShareToken(token: string | null): void {
  shareLoaded = true;
  shareTokenMem = token;
  const s = safeStorage('session');
  if (!s) return;
  if (token) s.setItem(SHARE_KEY, token);
  else s.removeItem(SHARE_KEY);
}

export function getGuestToken(shareToken: string): string | null {
  return safeStorage('local')?.getItem(GUEST_PREFIX + shareToken) ?? null;
}

export function setGuestToken(shareToken: string, guestToken: string): void {
  safeStorage('local')?.setItem(GUEST_PREFIX + shareToken, guestToken);
}

export function apiBaseUrl(): string {
  const env = import.meta.env as Record<string, string | undefined>;
  return env.VITE_API_ORIGIN ?? env.API_ORIGIN ?? 'http://localhost:5175';
}

/** Google 登入入口：頂層導覽到 API，由 API 導向 Google。 */
export function googleLoginUrl(): string {
  return `${apiBaseUrl().replace(/\/+$/, '')}${buildPath('googleLogin')}`;
}

export const apiClient = new ApiClient({
  baseUrl: apiBaseUrl(),
  getShareToken,
  getGuestToken,
});
