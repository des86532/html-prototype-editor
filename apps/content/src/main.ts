import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ApiResolver } from './apiResolver.js';
import { FixtureResolver } from './fixtureResolver.js';
import type { Resolver } from './resolver.js';
import { createContentServer } from './server.js';

const root = resolve(import.meta.dirname, '../../..');
if (existsSync(resolve(root, '.env'))) process.loadEnvFile(resolve(root, '.env'));

const env = process.env;
const port = Number(env.CONTENT_PORT ?? 5174);
const host = env.CONTENT_HOST ?? '127.0.0.1';
const baseDomain = env.CONTENT_BASE_DOMAIN ?? 'content.localhost:5174';
const appOrigin = env.APP_ORIGIN ?? 'http://localhost:5173';
const apiOrigin = env.API_ORIGIN ?? `http://localhost:${env.API_PORT ?? 5175}`;
const agentBundlePath =
  env.AGENT_BUNDLE_PATH ?? resolve(root, 'packages/frame-agent/dist/agent.v1.js');

let resolver: Resolver;
if (env.FIXTURE_DIR) {
  resolver = FixtureResolver.fromDirectory(resolve(root, env.FIXTURE_DIR));
  console.log(`[content] FixtureResolver: ${resolve(root, env.FIXTURE_DIR)}`);
} else {
  if (!env.INTERNAL_TOKEN)
    throw new Error('INTERNAL_TOKEN is required when FIXTURE_DIR is not set');
  resolver = new ApiResolver({
    origin: env.API_INTERNAL_ORIGIN ?? apiOrigin,
    token: env.INTERNAL_TOKEN,
    cacheMs: Number(env.CONTENT_RESOLVE_CACHE_MS ?? 0),
  });
}

const server = createContentServer({
  resolver,
  agentBundlePath,
  baseDomain,
  appOrigin,
  cspReportUrl: `${apiOrigin}/csp-report`,
  log: (msg, err) => console.error(`[content] ${msg}`, err ?? ''),
});
server.listen(port, host, () =>
  console.log(`[content] listening on http://${host}:${port} (base domain ${baseDomain})`),
);
for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, () => server.close(() => process.exit(0)));
