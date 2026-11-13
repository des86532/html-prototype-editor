import type { Config } from './config.js';
import type { Db } from './db/client.js';
import type { Mailer } from './mail.js';
import type { StorageAdapter } from './storage/types.js';

export interface AppDeps {
  config: Config;
  db: Db;
  storage: StorageAdapter;
  mailer: Mailer;
  /** 測試可注入時鐘 */
  now?: () => Date;
}

export interface AppContext extends AppDeps {
  now: () => Date;
}
