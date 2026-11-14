import type { Readable } from 'node:stream';
import { AppError, UPLOAD_LIMITS } from '@hpe/shared';
import yauzl from 'yauzl';
import { sanitizeEntryPath, finalizeEntries, type BundleFile } from './validateEntries.js';

export interface ExtractLimits {
  maxArchiveBytes: number;
  maxExtractedBytes: number;
  maxEntries: number;
  maxCompressionRatio: number;
}

export const DEFAULT_EXTRACT_LIMITS: ExtractLimits = {
  maxArchiveBytes: UPLOAD_LIMITS.maxArchiveBytes,
  maxExtractedBytes: UPLOAD_LIMITS.maxExtractedBytes,
  maxEntries: UPLOAD_LIMITS.maxEntries,
  maxCompressionRatio: UPLOAD_LIMITS.maxCompressionRatio,
};

/**
 * 壓縮比檢查只套用在解壓後超過此大小的檔案：極小的檔案（幾百位元組的 `{}`、空白填充）
 * 其 deflate 容器開銷會讓比值失真，且對資源耗盡沒有威脅（總量另有上限）。
 */
const RATIO_MIN_INFLATED_BYTES = 4096;

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

function isSymlink(entry: yauzl.Entry): boolean {
  const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
  return mode !== 0 && (mode & S_IFMT) === S_IFLNK;
}

function openZip(file: string | Buffer): Promise<yauzl.ZipFile> {
  const opts = { lazyEntries: true, decodeStrings: false, validateEntrySizes: true } as const;
  return new Promise((resolve, reject) => {
    const cb = (err: Error | null, zip?: yauzl.ZipFile) =>
      err || !zip ? reject(invalid(err)) : resolve(zip);
    if (typeof file === 'string') yauzl.open(file, { ...opts, autoClose: true }, cb);
    else yauzl.fromBuffer(file, opts, cb);
  });
}

function invalid(err: unknown): AppError {
  return new AppError('IMPORT_INVALID_ARCHIVE', '無法讀取壓縮檔（檔案損毀或不是 zip）', {
    reason: err instanceof Error ? err.message : String(err),
  });
}

/**
 * 串流解壓並在串流中強制所有限制（不信任 zip header 宣告的大小）：
 * - 壓縮檔大小、項目數、解壓後總量（以實際膨脹出的位元組計）、單檔壓縮比
 * - 路徑（絕對、`..`、反斜線、NUL）、symlink、副檔名白名單、NFC 正規化後重複
 * - 忽略 `__MACOSX/` 與 `.DS_Store`；所有檔案共用單一頂層資料夾時去掉該層
 * 任何違規都以對應的 `IMPORT_*` AppError 拒絕。
 *
 * @param source zip 檔案路徑（建議）或整個 Buffer
 * @param archiveBytes 壓縮檔大小（Buffer 時可省略）
 */
export async function extractZip(
  source: string | Buffer,
  archiveBytes: number,
  limits: ExtractLimits = DEFAULT_EXTRACT_LIMITS,
): Promise<BundleFile[]> {
  if (archiveBytes > limits.maxArchiveBytes) {
    throw new AppError('IMPORT_ARCHIVE_TOO_LARGE', '壓縮檔超過大小上限', {
      limit: limits.maxArchiveBytes,
    });
  }
  const zip = await openZip(source);
  if (zip.entryCount > limits.maxEntries) {
    zip.close();
    throw new AppError('IMPORT_TOO_MANY_ENTRIES', '壓縮檔內檔案數超過上限', {
      limit: limits.maxEntries,
    });
  }

  return new Promise<BundleFile[]>((resolve, reject) => {
    const files: BundleFile[] = [];
    const seen = new Set<string>();
    let totalInflated = 0;
    let seenEntries = 0;
    let settled = false;

    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      zip.close();
      reject(err instanceof AppError ? err : invalid(err));
    };

    zip.on('error', fail);
    zip.on('end', () => {
      if (settled) return;
      try {
        const out = finalizeEntries(files);
        settled = true;
        resolve(out);
      } catch (err) {
        fail(err);
      }
    });

    zip.on('entry', (entry: yauzl.Entry) => {
      try {
        seenEntries += 1;
        if (seenEntries > limits.maxEntries) {
          throw new AppError('IMPORT_TOO_MANY_ENTRIES', '壓縮檔內檔案數超過上限', {
            limit: limits.maxEntries,
          });
        }
        const rawName = Buffer.isBuffer(entry.fileName)
          ? entry.fileName.toString('utf8')
          : entry.fileName;
        const sanitized = sanitizeEntryPath(rawName);
        if (isSymlink(entry)) throw new AppError('IMPORT_SYMLINK', '壓縮檔內含 symlink');
        if (sanitized.kind !== 'file') return zip.readEntry();
        if (seen.has(sanitized.path)) {
          throw new AppError('IMPORT_DUPLICATE_PATH', `壓縮檔內有重複路徑：${sanitized.path}`, {
            path: sanitized.path,
          });
        }
        seen.add(sanitized.path);

        zip.openReadStream(entry, (err, stream) => {
          if (err || !stream) return fail(err);
          readEntry(stream, entry, limits, () => totalInflated)
            .then((data) => {
              totalInflated += data.length;
              files.push({ path: sanitized.path, data });
              zip.readEntry();
            })
            .catch(fail);
        });
      } catch (err) {
        fail(err);
      }
    });

    zip.readEntry();
  });
}

function readEntry(
  stream: Readable,
  entry: yauzl.Entry,
  limits: ExtractLimits,
  totalSoFar: () => number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let inflated = 0;
    const compressed = Math.max(entry.compressedSize, 1);
    const abort = (err: AppError) => {
      stream.destroy();
      reject(err);
    };
    stream.on('data', (chunk: Buffer) => {
      inflated += chunk.length;
      if (totalSoFar() + inflated > limits.maxExtractedBytes) {
        return abort(
          new AppError('IMPORT_EXTRACTED_TOO_LARGE', '解壓後總大小超過上限', {
            limit: limits.maxExtractedBytes,
          }),
        );
      }
      if (
        inflated > RATIO_MIN_INFLATED_BYTES &&
        inflated > limits.maxCompressionRatio * compressed
      ) {
        return abort(
          new AppError('IMPORT_COMPRESSION_RATIO', '壓縮比超過上限（疑似 zip bomb）', {
            limit: limits.maxCompressionRatio,
          }),
        );
      }
      chunks.push(chunk);
    });
    stream.on('error', (err) => reject(invalid(err)));
    stream.on('end', () => resolve(Buffer.concat(chunks, inflated)));
  });
}
