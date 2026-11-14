import type { Readable } from 'node:stream';

export const SHA256_RE = /^[a-f0-9]{64}$/;

/** 內容定址儲存：key 即內容的 sha256（hex 小寫）。 */
export interface StorageAdapter {
  /**
   * 寫入內容。已存在則略過。傳入 stream 時必須提供 size，且會驗證內容雜湊等於 sha256，不符丟出錯誤。
   */
  put(sha256: string, data: Buffer | Readable, size: number): Promise<void>;
  /** 找不到時丟出 AppError('NOT_FOUND') */
  get(sha256: string): Promise<Readable>;
  has(sha256: string): Promise<boolean>;
  delete(sha256: string): Promise<void>;
}

export function assertSha256(sha256: string): void {
  if (!SHA256_RE.test(sha256)) throw new Error(`invalid sha256: ${sha256.slice(0, 80)}`);
}
