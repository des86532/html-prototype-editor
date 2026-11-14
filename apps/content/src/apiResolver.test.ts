import type { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { ApiResolver } from './apiResolver.js';
import { BlobNotFoundError } from './resolver.js';

const SHA = 'a'.repeat(64);
const payload = {
  versionId: 'v1',
  contentKey: 'k',
  entryPage: 'index.html',
  cdnAllowlist: ['https://cdn.jsdelivr.net'],
  assets: [{ path: 'index.html', sha256: SHA, size: 3, mime: 'text/html' }],
};

function resolver(handler: (url: string, init: RequestInit) => Response, cacheMs = 0) {
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
    handler(String(url), init ?? {}),
  ) as unknown as typeof fetch;
  return {
    r: new ApiResolver({ origin: 'http://api.test:5175', token: 't0ken', fetchImpl, cacheMs }),
    fetchImpl,
  };
}

describe('ApiResolver', () => {
  it('calls /internal/content/:key with the internal token and parses the manifest', async () => {
    const { r, fetchImpl } = resolver(() => Response.json(payload));
    const v = await r.resolve('abc');
    expect(v?.entryPage).toBe('index.html');
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe('http://api.test:5175/internal/content/abc');
    expect((init.headers as Record<string, string>)['x-internal-token']).toBe('t0ken');
  });

  it('maps 404/403 to null and other failures to errors', async () => {
    expect(await resolver(() => new Response(null, { status: 404 })).r.resolve('x')).toBeNull();
    expect(await resolver(() => new Response(null, { status: 403 })).r.resolve('x')).toBeNull();
    await expect(
      resolver(() => new Response(null, { status: 500 })).r.resolve('x'),
    ).rejects.toThrow();
  });

  it('rejects malformed manifests', async () => {
    const bad = { ...payload, assets: [{ path: 'a', sha256: 'nothex', size: 1, mime: 'x' }] };
    await expect(resolver(() => Response.json(bad)).r.resolve('x')).rejects.toThrow(/malformed/);
  });

  it('url-encodes the key and caches only found results for cacheMs', async () => {
    const { r, fetchImpl } = resolver(
      (url) =>
        url.endsWith('/gone') ? new Response(null, { status: 404 }) : Response.json(payload),
      60_000,
    );
    await r.resolve('a/b');
    await r.resolve('a/b');
    await r.resolve('gone');
    await r.resolve('gone');
    const urls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(urls).toEqual([
      'http://api.test:5175/internal/content/a%2Fb',
      'http://api.test:5175/internal/content/gone',
      'http://api.test:5175/internal/content/gone',
    ]);
  });

  it('streams blobs and validates the sha256 before building a URL', async () => {
    const { r, fetchImpl } = resolver(() => new Response('abc'));
    const chunks: Buffer[] = [];
    for await (const c of (await r.openAsset(SHA)) as Readable)
      chunks.push(Buffer.from(c as Uint8Array));
    expect(Buffer.concat(chunks).toString()).toBe('abc');
    await expect(r.openAsset('../../etc/passwd')).rejects.toBeInstanceOf(BlobNotFoundError);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    await expect(
      resolver(() => new Response(null, { status: 404 })).r.openAsset(SHA),
    ).rejects.toBeInstanceOf(BlobNotFoundError);
  });
});
