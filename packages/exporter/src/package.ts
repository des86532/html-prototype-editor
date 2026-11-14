import { unzipSync, zipSync } from 'fflate';
import {
  AnnotationsDocumentSchema,
  AppError,
  ReviewPackageManifestSchema,
  UPLOAD_LIMITS,
} from '@hpe/shared';
import type {
  AnnotationsDocument,
  Author,
  Anchor,
  Comment,
  ReviewPackageManifest,
  Thread,
} from '@hpe/shared';
import { buildAnnotationsDocument, toJson } from './json.js';
import type { Bundle, ExportInput } from './types.js';

export interface BuildReviewPackageOptions {
  input: ExportInput;
  bundle: Bundle;
}

/** `manifest.json` + `annotations.json` + `bundle/<path>`。 */
export function buildReviewPackage(opts: BuildReviewPackageOptions): Uint8Array {
  const { input, bundle } = opts;
  const annotations = buildAnnotationsDocument(input);
  const manifest: ReviewPackageManifest = {
    format: 'hpe-review-package',
    formatVersion: 1,
    exportedAt: annotations.exportedAt,
    projectName: input.project.name,
    versionNumber: input.version.number,
    entryPage: input.version.entryPage,
    cdnAllowlist: [...input.version.cdnAllowlist],
    bundlePrefix: 'bundle/',
    annotationsPath: 'annotations.json',
  };
  const enc = new TextEncoder();
  const mtime = input.now ?? new Date();
  const files: Record<string, [Uint8Array, { mtime: Date }]> = {
    'manifest.json': [enc.encode(`${JSON.stringify(manifest, null, 2)}\n`), { mtime }],
    'annotations.json': [enc.encode(toJson(annotations)), { mtime }],
  };
  for (const [path, file] of bundle) files[`bundle/${path}`] = [file.data, { mtime }];
  return zipSync(files, { level: 6 });
}

export interface ParsedReviewPackage {
  manifest: ReviewPackageManifest;
  annotations: AnnotationsDocument;
  /** `bundle/` 底下的原始條目（路徑已去掉 `bundle/` 前綴，**尚未驗證**；匯入端必須走 zip 驗證流程）。 */
  files: { path: string; data: Uint8Array }[];
  /** 不屬於 manifest／annotations／bundle 的條目名稱。 */
  extraEntries: string[];
}

function invalid(message: string, details?: unknown): AppError {
  return new AppError('IMPORT_INVALID_ARCHIVE', message, details);
}

/**
 * 解析 Review Package。只做格式、manifest、annotations 的結構驗證，並有最基本的體積上限；
 * 不信任也不改寫條目路徑。
 */
export function parseReviewPackage(bytes: Uint8Array): ParsedReviewPackage {
  if (bytes.byteLength > UPLOAD_LIMITS.maxArchiveBytes) {
    throw new AppError('IMPORT_ARCHIVE_TOO_LARGE');
  }
  let entries: Record<string, Uint8Array>;
  let count = 0;
  let total = 0;
  try {
    entries = unzipSync(bytes, {
      filter: (f) => {
        count++;
        total += f.originalSize;
        if (count > UPLOAD_LIMITS.maxEntries + 2) throw new AppError('IMPORT_TOO_MANY_ENTRIES');
        if (total > UPLOAD_LIMITS.maxExtractedBytes)
          throw new AppError('IMPORT_EXTRACTED_TOO_LARGE');
        return true;
      },
    });
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw invalid('not a valid zip archive');
  }

  const dec = new TextDecoder('utf-8', { fatal: true });
  const readJson = (name: string): unknown => {
    const data = entries[name];
    if (!data) throw invalid(`missing ${name}`);
    try {
      return JSON.parse(dec.decode(data));
    } catch {
      throw invalid(`${name} is not valid JSON`);
    }
  };
  const manifest = ReviewPackageManifestSchema.safeParse(readJson('manifest.json'));
  if (!manifest.success) throw invalid('invalid manifest.json', manifest.error.issues);
  const annotations = AnnotationsDocumentSchema.safeParse(readJson('annotations.json'));
  if (!annotations.success) throw invalid('invalid annotations.json', annotations.error.issues);

  const files: { path: string; data: Uint8Array }[] = [];
  const extraEntries: string[] = [];
  for (const [name, data] of Object.entries(entries)) {
    if (name === 'manifest.json' || name === 'annotations.json' || name.endsWith('/')) continue;
    if (name.startsWith('bundle/')) files.push({ path: name.slice('bundle/'.length), data });
    else extraEntries.push(name);
  }
  return { manifest: manifest.data, annotations: annotations.data, files, extraEntries };
}

/** 再匯入用的討論串草稿（沒有 id、版本與編號；由匯入端重新配發）。 */
export interface ImportDraftThread {
  anchor: Anchor;
  status: Thread['status'];
  tags: Thread['tags'];
  createdBy: Author;
  createdAt: string;
  resolvedAt?: string;
  comments: { author: Author; body: string; createdAt: string; editedAt?: string }[];
}

export interface ImportDraft {
  threads: ImportDraftThread[];
}

function draftComment(c: Pick<Comment, 'author' | 'body' | 'createdAt' | 'editedAt'>) {
  return {
    author: c.author,
    body: c.body,
    createdAt: c.createdAt,
    ...(c.editedAt === undefined ? {} : { editedAt: c.editedAt }),
  };
}

/** 去掉 id 後的討論串（給匯出前後 deep-equal 比對與再匯入共用）。 */
export function threadsToImportDraft(threads: readonly Thread[]): ImportDraft {
  return {
    threads: [...threads]
      .sort((a, b) => a.number - b.number)
      .map((t) => ({
        anchor: t.anchor,
        status: t.status,
        tags: [...t.tags],
        createdBy: t.createdBy,
        createdAt: t.createdAt,
        ...(t.resolvedAt === undefined ? {} : { resolvedAt: t.resolvedAt }),
        comments: t.comments.map(draftComment),
      })),
  };
}

/** annotations.json（含 `x-hpe:` 欄位）→ 再匯入草稿，依編號排序。 */
export function reviewPackageToImportDraft(
  pkg: Pick<ParsedReviewPackage, 'annotations'> | AnnotationsDocument,
): ImportDraft {
  const doc = 'annotations' in pkg ? pkg.annotations : pkg;
  const items = [...doc.items].sort((a, b) => a['x-hpe:number'] - b['x-hpe:number']);
  return {
    threads: items.map((it) => ({
      anchor: it['x-hpe:anchor'],
      status: it['x-hpe:status'],
      tags: [...it['x-hpe:tags']],
      createdBy: it['x-hpe:createdBy'],
      createdAt: it.created,
      ...(it['x-hpe:resolvedAt'] === undefined ? {} : { resolvedAt: it['x-hpe:resolvedAt'] }),
      comments: it['x-hpe:comments'].map(draftComment),
    })),
  };
}
