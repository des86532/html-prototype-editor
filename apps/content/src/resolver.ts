import type { Readable } from 'node:stream';
import type { AssetManifestEntry } from '@hpe/shared';

export interface ResolvedVersion {
  versionId: string;
  entryPage: string;
  cdnAllowlist: string[];
  assets: AssetManifestEntry[];
}

/**
 * content server 與資料來源之間的唯一介面。
 * - 正式：`ApiResolver`（呼叫 API 的 /internal/*）
 * - 測試／開發：`FixtureResolver`（磁碟上的資料夾）
 */
export interface Resolver {
  /** 未知、已輪替或已撤銷的 contentKey 一律回 null（content server 回 404，不洩漏任何內容）。 */
  resolve(contentKey: string): Promise<ResolvedVersion | null>;
  /** 以內容雜湊串流輸出檔案；找不到時丟出 `BlobNotFoundError`。 */
  openAsset(sha256: string): Promise<Readable>;
}

export class BlobNotFoundError extends Error {
  constructor(sha256: string) {
    super(`blob not found: ${sha256}`);
    this.name = 'BlobNotFoundError';
  }
}

export const SHA256_RE = /^[0-9a-f]{64}$/;
