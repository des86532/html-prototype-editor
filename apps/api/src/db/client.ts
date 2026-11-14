import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;
export type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** db 與 transaction 皆可使用的最小介面。 */
export type DbLike = Db | DbTx;

export interface DbHandle {
  db: Db;
  pool: pg.Pool;
  close(): Promise<void>;
}

export const MIGRATIONS_FOLDER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../drizzle',
);

export interface CreateDbOptions {
  /** 指定 search_path（測試用：每個測試檔一個獨立 schema）。 */
  schemaName?: string;
  max?: number;
}

export function createDb(url: string, opts: CreateDbOptions = {}): DbHandle {
  const pool = new pg.Pool({
    connectionString: url,
    max: opts.max ?? 10,
    ...(opts.schemaName ? { options: `-c search_path=${opts.schemaName}` } : {}),
  });
  // 閒置連線的錯誤不能讓 process 掛掉
  pool.on('error', (err) => {
    console.error('[db] idle client error', err.message);
  });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}

/** 套用 drizzle/ 內的 SQL migrations（migration 記錄表放在目前 search_path 的 schema，互不干擾）。 */
export async function runMigrations(handle: DbHandle, schemaName = 'drizzle'): Promise<void> {
  await migrate(handle.db, {
    migrationsFolder: MIGRATIONS_FOLDER,
    migrationsSchema: schemaName,
  });
}
