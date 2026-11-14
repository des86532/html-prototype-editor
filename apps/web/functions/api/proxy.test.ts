// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { proxyToBackend } from './[[path]]';

function upstreamOk(init: ResponseInit = {}, body: string | null = '{"ok":true}') {
  return vi.fn(async (..._args: Parameters<typeof fetch>) => new Response(body, init));
}

describe('Pages Function /api 代理', () => {
  it('去掉 /api 前綴，保留 query，轉給 BACKEND_ORIGIN', async () => {
    const fetchImpl = upstreamOk();
    const req = new Request('https://app.pages.dev/api/auth/google/callback?code=c&state=s', {
      headers: { cookie: 'hpe_oauth=a.b.c', 'cf-connecting-ip': '203.0.113.9' },
    });
    await proxyToBackend(req, 'https://api.nail-it-tech.cc', fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe('https://api.nail-it-tech.cc/auth/google/callback?code=c&state=s');
    const headers = init!.headers as Headers;
    expect(headers.get('cookie')).toBe('hpe_oauth=a.b.c');
    expect(headers.get('x-forwarded-for')).toBe('203.0.113.9');
    expect(init!.redirect).toBe('manual');
  });

  it('302 與 Set-Cookie 原樣回給瀏覽器（不跟隨轉址）', async () => {
    const fetchImpl = upstreamOk(
      {
        status: 302,
        headers: {
          location: 'https://accounts.google.com/o/oauth2/v2/auth?x=1',
          'set-cookie': 'hpe_oauth=a.b.c; Path=/api/auth/google; HttpOnly',
        },
      },
      null,
    );
    const res = await proxyToBackend(
      new Request('https://app.pages.dev/api/auth/google'),
      'https://api.nail-it-tech.cc',
      fetchImpl,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://accounts.google.com/o/oauth2/v2/auth?x=1');
    expect(res.headers.get('set-cookie')).toContain('Path=/api/auth/google');
  });

  it('POST 帶 body 轉發', async () => {
    const fetchImpl = upstreamOk();
    await proxyToBackend(
      new Request('https://app.pages.dev/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"name":"x"}',
      }),
      'https://api.nail-it-tech.cc',
      fetchImpl,
    );
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init!.method).toBe('POST');
    expect(await new Response(init!.body).text()).toBe('{"name":"x"}');
  });

  it('不會被 //host 路徑導到其他主機', async () => {
    const fetchImpl = upstreamOk();
    await proxyToBackend(
      new Request('https://app.pages.dev/api//evil.example/x'),
      'https://api.nail-it-tech.cc',
      fetchImpl,
    );
    expect(new URL(String(fetchImpl.mock.calls[0]![0])).host).toBe('api.nail-it-tech.cc');
  });

  it('/internal 不對外轉發', async () => {
    const fetchImpl = upstreamOk();
    const res = await proxyToBackend(
      new Request('https://app.pages.dev/api/internal/content/abc'),
      'https://api.nail-it-tech.cc',
      fetchImpl,
    );
    expect(res.status).toBe(404);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('未設定 BACKEND_ORIGIN 或後端連不上 → 502', async () => {
    const req = () => new Request('https://app.pages.dev/api/me');
    expect((await proxyToBackend(req(), undefined)).status).toBe(502);
    const down = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    expect(
      (await proxyToBackend(req(), 'https://api.nail-it-tech.cc', down as unknown as typeof fetch))
        .status,
    ).toBe(502);
  });
});
