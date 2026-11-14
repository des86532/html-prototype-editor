import path from 'node:path';
import dotenv from 'dotenv';
import { REPO_ROOT } from '../config.js';
import { createDb, runMigrations } from './client.js';

dotenv.config({ path: path.join(REPO_ROOT, '.env'), quiet: true });

const url = process.env.DATABASE_URL ?? 'postgres://localhost:5432/hpe_dev';
const handle = createDb(url, { max: 1 });
try {
  await runMigrations(handle);
  console.log(`[db] migrations applied to ${url.replace(/\/\/[^@/]*@/, '//***@')}`);
} catch (err) {
  console.error('[db] migration failed:', err);
  process.exitCode = 1;
} finally {
  await handle.close();
}
