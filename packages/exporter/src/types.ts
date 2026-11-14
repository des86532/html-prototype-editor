import type { PrototypeVersion, Thread } from '@hpe/shared';

/** bundle 內的一個檔案（路徑為 bundle 相對路徑，使用 `/`）。 */
export interface BundleFile {
  data: Uint8Array;
  /** 缺省時由副檔名推測。 */
  mime?: string;
}

/** path → file。API 端把 storage 內容載入成 Map 後交給 exporter（exporter 不碰 DB／storage）。 */
export type Bundle = ReadonlyMap<string, BundleFile>;

export interface ExportInput {
  project: { id: string; name: string };
  version: PrototypeVersion;
  threads: Thread[];
  now?: Date;
}

/** 20 MB：單檔 HTML 超過就提醒（規格第 5 節）。 */
export const EXPORT_WARN_BYTES = 20 * 1024 * 1024;
