import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** security suite 的固定設定（埠號可用環境變數覆寫，預設與規格相同）。 */
const here = dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = resolve(here, '../..');
export const VECTORS_DIR = resolve(here, 'vectors');

export const HARNESS_PORT = Number(process.env.HARNESS_PORT ?? 5173);
export const CONTENT_PORT = Number(process.env.CONTENT_PORT ?? 5174);
/** 不能用 6000：它在瀏覽器的 blocked-port 清單（ERR_UNSAFE_PORT），所有外送請求都會「還沒送出就失敗」，斷言會變成空轉。 */
export const EVIL_PORT = 6100;

/** 向量用的固定 contentKey（26 個 base32 字元），以及另一組「已輪替／未知」的 key。 */
export const TEST_KEY = 'vectorsvectorsvectorsvecto';
export const UNKNOWN_KEY = 'unknownunknownunknownunkno';

export const CONTENT_BASE_DOMAIN = `content.localhost:${CONTENT_PORT}`;
export const APP_ORIGIN = `http://localhost:${HARNESS_PORT}`;
export const EVIL_ORIGIN = `http://evil.localhost:${EVIL_PORT}`;

/** 與 apps/web/src/harness/main.tsx 的 canary 一致。 */
export const CANARY_COOKIE = 'hpe_canary=canary-cookie-value';
export const CANARY_STORAGE_KEY = 'hpe_canary';
export const CANARY_STORAGE_VALUE = 'canary-localstorage-value';

export const SECRETS = ['SECRET-COMMENT-BODY', 'SECRET-AUTHOR-NAME', 'SECRET-SHARE-TOKEN'] as const;

export const agentBundlePath = resolve(REPO_ROOT, 'packages/frame-agent/dist/agent.v1.js');
