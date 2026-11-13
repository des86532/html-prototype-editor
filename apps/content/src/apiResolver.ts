import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { API_HEADERS, API_ROUTES, type AssetManifestEntry } from '@hpe/shared';
import { BlobNotFoundError, SHA256_RE, type ResolvedVersion, type Resolver } from './resolver.js';

export interface ApiResolverOptions {
  /** `API_INTERNAL_ORIGIN`，例如 http://localhost:5175 */
  origin: string;
  /** `INTERNAL_TOKEN`（header `x-internal-token`） */
  token: string;
  /**
   * resolve 結果的快取時間（ms），預設 0＝不快取：規格要求「換 contentKey 立即生效」（V23）。
   * 高流量部署可以用 CONTENT_RESOLVE_CACHE_MS 啟用快取；只快取「找到」的結果，輪替後最多再有效 cacheMs。
   */
  cacheMs?: number;
  fetchImpl?: typeof fetch;
  /** 等待 API 回應 header 的逾時（ms），預設 10 秒 */
  timeoutMs?: number;
}

function isEntry(v: unknown): v is AssetManifestEntry {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.path === 'string' &&
    typeof e.sha256 === 'string' &&
    SHA256_RE.test(e.sha256) &&
    typeof e.size === 'number' &&
    typeof e.mime === 'string'
  );
}

function parseResolved(json: unknown): ResolvedVersion {
  const o = (json ?? {}) as Record<string, unknown>;
  if (
    typeof o.versionId !== 'string' ||
    typeof o.entryPage !== 'string' ||
    !Array.isArray(o.cdnAllowlist) ||
    !o.cdnAllowlist.every((c) => typeof c === 'string') ||
    !Array.isArray(o.assets) ||
    !o.assets.every(isEntry)
  )
    throw new Error('malformed /internal/content response');
  return {
    versionId: o.versionId,
    entryPage: o.entryPage,
    cdnAllowlist: o.cdnAllowlist as string[],
    assets: o.assets as AssetManifestEntry[],
  };
}

/** 正式環境的 resolver：呼叫 API 的 `/internal/content/:contentKey`、`/internal/blob/:sha256`。 */
export class ApiResolver implements Resolver {
  private readonly cache = new Map<string, { at: number; value: ResolvedVersion }>();
  private readonly cacheMs: number;
  private readonly doFetch: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly opts: ApiResolverOptions) {
    this.cacheMs = opts.cacheMs ?? 0;
    this.doFetch = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  private url(route: 'internalContent' | 'internalBlob', id: string): string {
    const path = API_ROUTES[route].path.replace(':id', encodeURIComponent(id));
    return new URL(path, this.opts.origin).toString();
  }

  private async get(url: string): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      return await this.doFetch(url, {
        headers: { [API_HEADERS.internalToken]: this.opts.token },
        signal: ctrl.signal,
        redirect: 'error',
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async resolve(contentKey: string): Promise<ResolvedVersion | null> {
    const now = Date.now();
    const hit = this.cache.get(contentKey);
    if (hit && now - hit.at < this.cacheMs) return hit.value;
    this.cache.delete(contentKey);
    const res = await this.get(this.url('internalContent', contentKey));
    if (res.status === 404 || res.status === 403 || res.status === 410) {
      await res.body?.cancel();
      return null;
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`/internal/content responded ${res.status}`);
    }
    const value = parseResolved(await res.json());
    if (this.cacheMs > 0) {
      if (this.cache.size > 1000) this.cache.clear();
      this.cache.set(contentKey, { at: now, value });
    }
    return value;
  }

  async openAsset(sha256: string): Promise<Readable> {
    if (!SHA256_RE.test(sha256)) throw new BlobNotFoundError(sha256);
    const res = await this.get(this.url('internalBlob', sha256));
    if (res.status === 404) {
      await res.body?.cancel();
      throw new BlobNotFoundError(sha256);
    }
    if (!res.ok || !res.body) {
      await res.body?.cancel();
      throw new Error(`/internal/blob responded ${res.status}`);
    }
    return Readable.fromWeb(res.body as WebReadableStream);
  }
}
