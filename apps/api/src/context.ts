import type { Config } from './config.js';
import type { Db } from './db/client.js';
import type { GoogleOAuth } from './auth/google.js';
import type { StorageAdapter } from './storage/types.js';

export interface AppDeps {
  config: Config;
  db: Db;
  storage: StorageAdapter;
  /** null = 未設定 Google 登入 */
  google: GoogleOAuth | null;
  /** 測試可注入時鐘 */
  now?: () => Date;
}

export interface AppContext extends AppDeps {
  now: () => Date;
}
