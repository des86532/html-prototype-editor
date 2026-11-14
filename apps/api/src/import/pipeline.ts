import { AppError, UPLOAD_LIMITS } from '@hpe/shared';
import { eq, inArray, max, sql } from 'drizzle-orm';
import mime from 'mime-types';
import type { Db, DbTx } from '../db/client.js';
import { assets, projects, prototypeVersions } from '../db/schema.js';
import { newContentKey, newId, sha256Hex } from '../ids.js';
import type { StorageAdapter } from '../storage/types.js';
import { analyzeBundle } from './analyze.js';
import { detectEntry } from './entryDetect.js';
import { extensionOf, finalizeEntries, type BundleFile } from './validateEntries.js';

/** 匯入時持 shared lock、清除孤立 blob 時持 exclusive lock，避免剛寫入的 blob 被誤刪。 */
export const BLOB_LOCK_KEY = 7_301_001;

const MIME_OVERRIDES: Record<string, string> = {
  html: 'text/html',
  htm: 'text/html',
  js: 'text/javascript',
  mjs: 'text/javascript',
  json: 'application/json',
  map: 'application/json',
  svg: 'image/svg+xml',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  avif: 'image/avif',
  txt: 'text/plain',
};

/** MIME 一律由副檔名決定，絕不採用上傳時宣稱的類型。 */
export function mimeForPath(p: string): string {
  const ext = extensionOf(p);
  return MIME_OVERRIDES[ext] ?? (mime.lookup(ext) || 'application/octet-stream');
}

/** 單一 HTML／貼上原始碼 → 只有一個檔案（index.html）的 bundle。 */
export function singleHtmlBundle(html: Buffer): BundleFile[] {
  if (html.length > UPLOAD_LIMITS.maxSingleHtmlBytes) {
    throw new AppError('IMPORT_ARCHIVE_TOO_LARGE', 'HTML 超過大小上限', {
      limit: UPLOAD_LIMITS.maxSingleHtmlBytes,
    });
  }
  return finalizeEntries([{ path: 'index.html', data: html }]);
}

export interface ImportDeps {
  db: Db;
  storage: StorageAdapter;
}

async function putAll(
  storage: StorageAdapter,
  blobs: Map<string, Buffer>,
  concurrency = 8,
): Promise<void> {
  const queue = [...blobs.entries()];
  const worker = async () => {
    for (let item = queue.pop(); item; item = queue.pop()) {
      await storage.put(item[0], item[1], item[1].length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
}

export interface ImportResult {
  versionId: string;
}

/**
 * 分析 bundle、把內容定址的 blob 寫入 storage，並建立版本（含 assets）。
 * 入口不明確（多個 HTML 且沒有 index.html）時版本狀態為 `processing`，附 entryCandidates。
 */
export async function importBundle(
  deps: ImportDeps,
  input: {
    projectId: string;
    files: BundleFile[];
    entryPage?: string | undefined;
    /** 已驗證的 CDN allowlist origin（Review Package 再匯入時帶入） */
    cdnAllowlist?: string[];
    /** 在建立版本的同一個 transaction 內執行（例如建立討論串）。 */
    afterInsert?: (tx: DbTx, ctx: { versionId: string; projectId: string }) => Promise<void>;
  },
): Promise<ImportResult> {
  const cdnAllowlist = input.cdnAllowlist ?? [];
  const { report, pages } = analyzeBundle(input.files, cdnAllowlist);
  const decision = detectEntry(pages, input.entryPage);

  const blobs = new Map<string, Buffer>();
  const rows = input.files.map((f) => {
    const sha256 = sha256Hex(f.data);
    blobs.set(sha256, f.data);
    return { path: f.path, sha256, size: f.data.length, mime: mimeForPath(f.path) };
  });

  const versionId = newId();
  await deps.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock_shared(${BLOB_LOCK_KEY}::bigint)`);
    await putAll(deps.storage, blobs);
    // 鎖住 project 列：同一專案同時匯入時版本編號不會重複
    const locked = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .for('update');
    if (locked.length === 0) throw new AppError('NOT_FOUND');
    const [agg] = await tx
      .select({ n: max(prototypeVersions.number) })
      .from(prototypeVersions)
      .where(eq(prototypeVersions.projectId, input.projectId));
    await tx.insert(prototypeVersions).values({
      id: versionId,
      projectId: input.projectId,
      number: (agg?.n ?? 0) + 1,
      contentKey: newContentKey(),
      entryPage: decision.entryPage,
      pages,
      cdnAllowlist,
      analysis: report,
      status: decision.status,
      entryCandidates: decision.candidates,
    });
    await tx.insert(assets).values(rows.map((r) => ({ ...r, versionId })));
    await input.afterInsert?.(tx, { versionId, projectId: input.projectId });
  });
  return { versionId };
}

/** 刪除版本／專案後，清除不再被任何 asset 參照的 blob。 */
export async function gcBlobs(deps: ImportDeps, candidates: string[]): Promise<void> {
  const unique = [...new Set(candidates)];
  if (unique.length === 0) return;
  await deps.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${BLOB_LOCK_KEY}::bigint)`);
    const referenced = new Set<string>();
    for (let i = 0; i < unique.length; i += 1000) {
      const chunk = unique.slice(i, i + 1000);
      const found = await tx
        .selectDistinct({ sha: assets.sha256 })
        .from(assets)
        .where(inArray(assets.sha256, chunk));
      for (const r of found) referenced.add(r.sha);
    }
    for (const sha of unique) {
      if (!referenced.has(sha)) await deps.storage.delete(sha);
    }
  });
}
