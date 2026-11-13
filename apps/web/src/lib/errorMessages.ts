import { UPLOAD_LIMITS } from '@hpe/shared';
import type { ClientErrorCode } from './apiClient';

const mb = (n: number) => `${Math.round(n / (1024 * 1024))} MB`;

/** 錯誤代碼 → 繁體中文訊息（伺服器的 message 不直接顯示，避免洩漏內部資訊）。 */
export const ERROR_MESSAGES: Record<ClientErrorCode, string> = {
  BAD_REQUEST: '請求內容不正確，請檢查後再試一次。',
  UNAUTHENTICATED: '請先登入。',
  FORBIDDEN: '你沒有權限執行這個動作。',
  NOT_FOUND: '找不到要求的資料。',
  CONFLICT: '資料已被更新，請重新整理後再試。',
  RATE_LIMITED: '操作太頻繁，請稍後再試。',
  INTERNAL: '伺服器發生錯誤，請稍後再試。',
  NETWORK: '無法連線到伺服器，請檢查網路。',
  BAD_RESPONSE: '伺服器回應格式錯誤。',
  IMPORT_ARCHIVE_TOO_LARGE: `壓縮檔超過 ${mb(UPLOAD_LIMITS.maxArchiveBytes)} 上限。`,
  IMPORT_EXTRACTED_TOO_LARGE: `解壓縮後超過 ${mb(UPLOAD_LIMITS.maxExtractedBytes)} 上限。`,
  IMPORT_TOO_MANY_ENTRIES: `檔案數量超過 ${UPLOAD_LIMITS.maxEntries} 個上限。`,
  IMPORT_COMPRESSION_RATIO: `壓縮比超過 ${UPLOAD_LIMITS.maxCompressionRatio}:1，疑似壓縮炸彈，已拒絕。`,
  IMPORT_PATH_TRAVERSAL: '壓縮檔含有跳出目錄的路徑（../），已拒絕。',
  IMPORT_ABSOLUTE_PATH: '壓縮檔含有絕對路徑，已拒絕。',
  IMPORT_SYMLINK: '壓縮檔含有符號連結，已拒絕。',
  IMPORT_BACKSLASH_PATH: '壓縮檔路徑含有反斜線（\\），已拒絕。',
  IMPORT_NUL_IN_PATH: '壓縮檔路徑含有不合法字元，已拒絕。',
  IMPORT_EXTENSION_NOT_ALLOWED: '壓縮檔含有不允許的檔案類型。',
  IMPORT_DUPLICATE_PATH: '壓縮檔含有重複的路徑。',
  IMPORT_NO_HTML: '找不到任何 HTML 頁面。',
  IMPORT_INVALID_ARCHIVE: '無法讀取這個壓縮檔，檔案可能已損毀。',
  IMPORT_ENTRY_REQUIRED: '請選擇入口頁面。',
  SHARE_REVOKED: '這個分享連結已被撤銷。',
  SHARE_EXPIRED: '這個分享連結已過期。',
  SHARE_ROLE_FORBIDDEN: '這個連結的角色無法執行此動作。',
  GUEST_REQUIRED: '請先填寫你的名字。',
  PROTOCOL_INVALID: '訊息格式不正確。',
};

/** 任何 thrown 值 → 使用者看得懂的訊息。 */
export function messageForError(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && code in ERROR_MESSAGES) {
    return ERROR_MESSAGES[code as ClientErrorCode];
  }
  return ERROR_MESSAGES.INTERNAL;
}
