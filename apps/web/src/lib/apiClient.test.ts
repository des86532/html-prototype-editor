import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@hpe/shared';
import {
  ApiClient,
  ApiError,
  parseContentDisposition,
  setGuestToken,
  setShareToken,
} from './apiClient';
import { createApi } from './api';
import { ERROR_MESSAGES, messageForError } from './errorMessages';

function client(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
  share: string | null = null,
) {
  const fetchImpl = vi.fn((url: string, init: RequestInit) => Promise.resolve(handler(url, init)));
  const c = new ApiClient({
    baseUrl: 'http://api.test/',
    fetchImpl: fetchImpl as unknown as typeof fetch,
    getShareToken: () => share,
    getGuestToken: (t) => (t === share ? 'guest-tok' : null),
  });
  return { c, api: createApi(c), fetchImpl };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

beforeEach(() => {
  setShareToken(null);
  localStorage.clear();
});

describe('ApiClient', () => {
  it('builds URLs from API_ROUTES, includes credentials and JSON bodies', async () => {
    const { api, fetchImpl } = client(() => json({ thread: { id: 't' } }));
    await api.updateThread('t/1', { status: 'resolved' });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://api.test/threads/t%2F1');
    expect(init.method).toBe('PATCH');
    expect(init.credentials).toBe('include');
    expect(init.body).toBe('{"status":"resolved"}');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  it('sends x-share-token and x-guest-token when a share token is active', async () => {
    const { api, fetchImpl } = client(() => json({ threads: [] }), 'share-abc');
    await api.listThreads('v1');
    const h = fetchImpl.mock.calls[0]![1].headers as Record<string, string>;
    expect(h['x-share-token']).toBe('share-abc');
    expect(h['x-guest-token']).toBe('guest-tok');
  });

  it('omits share headers for owners', async () => {
    const { api, fetchImpl } = client(() => json({ threads: [] }));
    await api.listThreads('v1');
    const h = fetchImpl.mock.calls[0]![1].headers as Record<string, string>;
    expect(h['x-share-token']).toBeUndefined();
  });

  it('maps { error: { code, message } } to ApiError', async () => {
    const { api } = client(() =>
      json({ error: { code: 'SHARE_REVOKED', message: 'gone', details: { a: 1 } } }, 403),
    );
    const err = await api.me().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 403, code: 'SHARE_REVOKED', details: { a: 1 } });
  });

  it('maps network failures and malformed bodies', async () => {
    const f = vi.fn().mockRejectedValue(new TypeError('x'));
    const c = new ApiClient({ baseUrl: 'http://a', fetchImpl: f as unknown as typeof fetch });
    await expect(c.request('me')).rejects.toMatchObject({ code: 'NETWORK' });
    const { api } = client(() => new Response('<html>', { status: 502 }));
    await expect(api.me()).rejects.toMatchObject({ code: 'INTERNAL', status: 502 });
  });

  it('uploads files as multipart (no manual content-type)', async () => {
    const { api, fetchImpl } = client(() => json({ version: {} }));
    await api.createVersionFromFile('p1', new File(['<html>'], 'a.html'), 'a.html');
    const init = fetchImpl.mock.calls[0]![1];
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('entryPage')).toBe('a.html');
    expect((init.headers as Record<string, string>)['content-type']).toBeUndefined();
  });

  it('download returns blob + filename from Content-Disposition, with query filters', async () => {
    const { api, fetchImpl } = client(
      () =>
        new Response('x', {
          headers: { 'content-disposition': 'attachment; filename="review-a-v1.html"' },
        }),
    );
    const r = await api.exportVersion('v1', 'html', { status: 'open', tag: 'bug' });
    expect(fetchImpl.mock.calls[0]![0]).toBe(
      'http://api.test/versions/v1/export/html?status=open&tag=bug',
    );
    expect(r.filename).toBe('review-a-v1.html');
    expect(await r.blob.text()).toBe('x');
  });

  it('guest/share tokens: guest token lives in localStorage keyed by share token', () => {
    setGuestToken('s1', 'g');
    expect(localStorage.getItem('hpe.guestToken.s1')).toBe('g');
    setShareToken('s1');
    expect(sessionStorage.getItem('hpe.shareToken')).toBe('s1');
    setShareToken(null);
    expect(sessionStorage.getItem('hpe.shareToken')).toBeNull();
  });
});

describe('parseContentDisposition', () => {
  it('handles filename*, quoted and plain forms', () => {
    expect(parseContentDisposition("attachment; filename*=UTF-8''%E5%AF%A9%E9%96%B1.json")).toBe(
      '審閱.json',
    );
    expect(parseContentDisposition('attachment; filename="a b.zip"')).toBe('a b.zip');
    expect(parseContentDisposition('attachment; filename=a.csv')).toBe('a.csv');
    expect(parseContentDisposition(null)).toBeNull();
  });
});

describe('error code → message mapping', () => {
  it('has a Traditional Chinese message for every shared error code', () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_MESSAGES[code], code).toMatch(/[\u4e00-\u9fff]/);
      expect(messageForError(new ApiError(400, code, 'raw'))).toBe(ERROR_MESSAGES[code]);
    }
  });
  it('never leaks the server message and falls back for unknown errors', () => {
    expect(messageForError(new ApiError(500, 'INTERNAL', 'stack trace at ...'))).not.toContain(
      'stack',
    );
    expect(messageForError(new Error('boom'))).toBe(ERROR_MESSAGES.INTERNAL);
  });
});
