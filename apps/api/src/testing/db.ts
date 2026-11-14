import { ulid } from 'ulid';
import pg from 'pg';
import { createDb, runMigrations, type DbHandle } from '../db/client.js';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/hpe_test';

export interface TestDb extends DbHandle {
  schemaName: string;
  /** 清空所有資料表（保留結構） */
  truncateAll(): Promise<void>;
  drop(): Promise<void>;
}

/**
 * 為單一測試檔建立獨立的 Postgres schema 並套用 migrations：
 * 不同測試檔（與其他 package 的測試）彼此完全隔離，可平行執行。
 */
export async function createTestDb(): Promise<TestDb> {
  const schemaName = `t_${ulid().toLowerCase()}`;
  const admin = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await admin.connect();
  try {
    await admin.query(`CREATE SCHEMA "${schemaName}"`);
  } finally {
    await admin.end();
  }
  const handle = createDb(TEST_DATABASE_URL, { schemaName, max: 8 });
  try {
    await runMigrations(handle, schemaName);
  } catch (err) {
    await handle.close();
    await dropSchema(schemaName);
    throw err;
  }
  return {
    ...handle,
    schemaName,
    async truncateAll() {
      const res = await handle.pool.query<{ tablename: string }>(
        'select tablename from pg_tables where schemaname = $1 and tablename not like $2',
        [schemaName, '%migrations%'],
      );
      if (res.rows.length === 0) return;
      const list = res.rows.map((r) => `"${schemaName}"."${r.tablename}"`).join(', ');
      await handle.pool.query(`TRUNCATE ${list} CASCADE`);
    },
    async drop() {
      await handle.close();
      await dropSchema(schemaName);
    },
  };
}

async function dropSchema(schemaName: string): Promise<void> {
  const cleanup = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await cleanup.connect();
  try {
    await cleanup.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  } finally {
    await cleanup.end();
  }
}
