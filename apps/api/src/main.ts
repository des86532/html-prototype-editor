import path from 'node:path';
import dotenv from 'dotenv';
import { buildApp } from './app.js';
import { GoogleOAuthClient } from './auth/google.js';
import { loadConfig, REPO_ROOT } from './config.js';
import { createDb } from './db/client.js';
import { createStorage } from './storage/index.js';

dotenv.config({ path: path.join(REPO_ROOT, '.env'), quiet: true });

const config = loadConfig();
const { db, close } = createDb(config.databaseUrl);
const google = config.google ? new GoogleOAuthClient(config.google) : null;
const app = await buildApp(
  { config, db, storage: createStorage(config), google },
  { logger: true },
);

if (!process.env.INTERNAL_TOKEN) {
  app.log.warn('INTERNAL_TOKEN 未設定，使用開發用預設值（content server 需使用相同值）');
}

const shutdown = async () => {
  await app.close();
  await close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.apiPort, host: process.env.API_HOST ?? '127.0.0.1' });
