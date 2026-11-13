import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FixtureResolver } from './fixtureResolver.js';
import { buildContentCsp, sanitizeOrigins } from './headers.js';
import { createContentServer } from './server.js';

const KEY = 'testtesttesttesttesttestte';
const OTHER = 'otherotherotherotherotherot';
const BASE = 'content.localhost:5174';
const APP = 'http://localhost:5173';
const AGENT = 'console.log("agent")';

let server: Server;
let port: number;
let dir: string;
let resolver: FixtureResolver;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'hpe-content-'));
  const site = join(dir, 'site');
  mkdirSync(join(site, 'sub'), { recursive: true });
  writeFileSync(
    join(site, 'index.html'),
    '<!doctype html><html><head><title>t</title></head><body>hi</body></html>',
  );
  writeFileSync(join(site, 'nohead.htm'), '<p>no head</p>');
  writeFileSync(join(site, 'sub', 'index.html'), '<head></head>sub');
  writeFileSync(join(site, 'app.js'), 'var a=1;');
  writeFileSync(join(site, 'data.json'), '{"a":1}');
  writeFileSync(
    join(site, 'logo.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  );
  writeFileSync(join(site, 'evil.php'), '<?php ?>');
  writeFileSync(join(site, 'sniff.txt'), '<html><script>alert(1)</script></html>');
  writeFileSync(join(dir, 'secret.txt'), 'outside');
  symlinkSync(join(dir, 'secret.txt'), join(site, 'link.txt'));
  writeFileSync(join(dir, 'agent.js'), AGENT);
  resolver = new FixtureResolver({
    [KEY]: { dir: site, cdnAllowlist: ['https://cdn.jsdelivr.net', 'https://fonts.gstatic.com'] },
  });
  server = createContentServer({
    resolver,
    agentBundlePath: join(dir, 'agent.js'),
    baseDomain: BASE,
    appOrigin: APP,
    cspReportUrl: 'http://localhost:5175/csp-report',
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}
function get(
  path: string,
  opts: { host?: string; method?: string; headers?: Record<string, string> } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: opts.method ?? 'GET',
        headers: { host: opts.host ?? `${KEY}.${BASE}`, ...opts.headers },
      },
      (res) => {
        const parts: Buffer[] = [];
        res.on('data', (c: Buffer) => parts.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(parts).toString(),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

const EXPECTED_CSP =
  "sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.gstatic.com; img-src 'self' data: blob:; font-src 'self' data: https://cdn.jsdelivr.net https://fonts.gstatic.com; media-src 'self' data: blob:; connect-src 'self' http://testtesttesttesttesttestte.content.localhost:5174; frame-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors http://localhost:5173; report-to csp-endpoint";

describe('HTML response headers (spec, exact)', () => {
  it('sends the full header set and injects the agent', async () => {
    const r = await get('/');
    expect(r.status).toBe(200);
    expect(r.headers['content-security-policy']).toBe(EXPECTED_CSP);
    expect(r.headers['permissions-policy']).toBe(
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), clipboard-read=(), display-capture=()',
    );
    expect(r.headers['referrer-policy']).toBe('no-referrer');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['cross-origin-resource-policy']).toBe('same-site');
    expect(r.headers['cache-control']).toBe('private, max-age=300');
    expect(r.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(r.headers['access-control-allow-origin']).toBe('*');
    expect(r.headers['reporting-endpoints']).toBe(
      'csp-endpoint="http://localhost:5175/csp-report"',
    );
    expect(r.body).toBe(
      '<!doctype html><html><head><script src="/__hpe/agent.v1.js" data-hpe-page="index.html"></script><title>t</title></head><body>hi</body></html>',
    );
  });

  it('uses the page path as data-hpe-page and creates <head> when missing', async () => {
    const r = await get('/nohead.htm');
    expect(r.body).toBe(
      '<head><script src="/__hpe/agent.v1.js" data-hpe-page="nohead.htm"></script></head><p>no head</p>',
    );
    const sub = await get('/sub/');
    expect(sub.body).toContain('data-hpe-page="sub/index.html"');
  });

  it('frame-ancestors never allows anything but APP_ORIGIN, and CDN values cannot inject directives', () => {
    const csp = buildContentCsp(
      [
        'https://ok.example',
        'https://x; script-src *',
        'https://*.evil.com',
        "'unsafe-eval'",
        'https://a b',
      ],
      APP,
    );
    expect(csp).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval' https://ok.example;");
    expect(csp).not.toContain('evil');
    expect(csp).not.toContain('script-src *');
    expect(csp.match(/frame-ancestors/g)).toHaveLength(1);
    expect(sanitizeOrigins(['HTTPS://CDN.Example.com:8443', 'https://x/path'])).toEqual([
      'https://cdn.example.com:8443',
    ]);
    expect(() => buildContentCsp([], 'not an origin')).toThrow();
  });
});

describe('non-HTML responses', () => {
  it('decides Content-Type by extension and never sniffs', async () => {
    const js = await get('/app.js');
    expect(js.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(js.headers['x-content-type-options']).toBe('nosniff');
    expect(js.headers['access-control-allow-origin']).toBe('*');
    expect(js.headers['cache-control']).toBe('private, max-age=300');
    expect(js.headers['content-security-policy']).toBeUndefined();
    expect(js.headers['cross-origin-resource-policy']).toBeUndefined();
    expect(js.body).toBe('var a=1;');
    expect((await get('/data.json')).headers['content-type']).toBe(
      'application/json; charset=utf-8',
    );
    expect((await get('/sniff.txt')).headers['content-type']).toBe('text/plain; charset=utf-8');
  });

  it('serves SVG with the CSP sandbox header and does not inject the agent', async () => {
    const r = await get('/logo.svg');
    expect(r.headers['content-type']).toBe('image/svg+xml');
    expect(r.headers['content-security-policy']).toBe(EXPECTED_CSP);
    expect(r.body).not.toContain('__hpe');
  });

  it('refuses non-whitelisted extensions and symlinks', async () => {
    expect((await get('/evil.php')).status).toBe(404);
    expect((await get('/link.txt')).status).toBe(404);
  });
});

describe('agent bundle', () => {
  it('serves /__hpe/agent.v1.js with revalidation, ETag and 304', async () => {
    const r = await get('/__hpe/agent.v1.js');
    expect(r.status).toBe(200);
    expect(r.body).toBe(AGENT);
    expect(r.headers['cache-control']).toBe('no-cache');
    expect(r.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(r.headers['access-control-allow-origin']).toBe('*');
    const etag = String(r.headers.etag);
    const again = await get('/__hpe/agent.v1.js', { headers: { 'if-none-match': etag } });
    expect(again.status).toBe(304);
  });
  it('only exists for a valid contentKey and no other __hpe path is served', async () => {
    expect((await get('/__hpe/agent.v1.js', { host: `${OTHER}.${BASE}` })).status).toBe(404);
    expect((await get('/__hpe/other.js')).status).toBe(404);
    expect((await get('/__hpe/')).status).toBe(404);
  });
});

describe('routing and rejection (404 with an empty body)', () => {
  const expectEmpty404 = (r: Reply) => {
    expect(r.status).toBe(404);
    expect(r.body).toBe('');
    expect(r.headers['content-length']).toBe('0');
    expect(r.headers['content-security-policy']).toBeUndefined();
  };
  it('unknown, malformed or foreign Host', async () => {
    expectEmpty404(await get('/', { host: `${OTHER}.${BASE}` }));
    expectEmpty404(await get('/', { host: BASE }));
    expectEmpty404(await get('/', { host: `${KEY}.${BASE}.evil.com` }));
    expectEmpty404(await get('/', { host: `${KEY}.content.localhost:9999` }));
    expectEmpty404(await get('/', { host: 'localhost:5174' }));
  });
  it('a rotated contentKey stops resolving immediately (V23, content half)', async () => {
    resolver.set(OTHER, { dir: join(dir, 'site') });
    expect((await get('/', { host: `${OTHER}.${BASE}` })).status).toBe(200);
    resolver.revoke(OTHER);
    expectEmpty404(await get('/', { host: `${OTHER}.${BASE}` }));
    expectEmpty404(await get('/app.js', { host: `${OTHER}.${BASE}` }));
  });
  it.each([
    '/../secret.txt',
    '/%2e%2e/secret.txt',
    '/sub/..%2f..%2fsecret.txt',
    '/a%00.html',
    '/a%5c..%5csecret.txt',
    '/..\\secret.txt',
    '/%',
  ])('path %s', async (p) => {
    expectEmpty404(await get(p));
  });
  it('missing file, directory without index', async () => {
    expectEmpty404(await get('/missing.html'));
    expectEmpty404(await get('/sub'));
  });
  it('only GET and HEAD', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
      const r = await get('/', { method });
      expect(r.status).toBe(405);
      expect(r.headers.allow).toBe('GET, HEAD');
      expect(r.body).toBe('');
    }
    const head = await get('/', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.body).toBe('');
    expect(head.headers['content-security-policy']).toBe(EXPECTED_CSP);
  });
});
