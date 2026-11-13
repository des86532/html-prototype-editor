import { ALLOWED_EXTENSIONS, AppError, PAGE_EXTENSIONS } from '@hpe/shared';

const ALLOWED = new Set<string>(ALLOWED_EXTENSIONS);
const PAGE_EXT = new Set<string>(PAGE_EXTENSIONS);

export interface BundleFile {
  /** 正規化後的 bundle 相對路徑（NFC、正斜線、無前導斜線） */
  path: string;
  data: Buffer;
}

export function extensionOf(p: string): string {
  const base = p.slice(p.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot < 0 ? '' : base.slice(dot + 1).toLowerCase();
}

export function isPagePath(p: string): boolean {
  return PAGE_EXT.has(extensionOf(p));
}

export type SanitizedPath = { kind: 'file'; path: string } | { kind: 'dir' } | { kind: 'ignored' };

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * 檢查 zip 內單一項目名稱（V17）。順序即優先權：NUL → 反斜線 → 絕對路徑 → `..` → 其他控制字元。
 * 目錄項目回傳 `dir`；`__MACOSX/`、`.DS_Store` 回傳 `ignored`（但仍先通過安全檢查）。
 * 一般檔案另外套用副檔名白名單（不分大小寫）。
 */
export function sanitizeEntryPath(raw: string): SanitizedPath {
  if (raw.includes('\0')) throw new AppError('IMPORT_NUL_IN_PATH', '壓縮檔內有路徑含 NUL 字元');
  if (raw.includes('\\')) throw new AppError('IMPORT_BACKSLASH_PATH', '壓縮檔內有路徑使用反斜線');
  if (raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) {
    throw new AppError('IMPORT_ABSOLUTE_PATH', '壓縮檔內有絕對路徑');
  }
  const isDir = raw.endsWith('/');
  const normalized = raw.normalize('NFC');
  const segments = normalized.split('/').filter((s) => s !== '' && s !== '.');
  if (segments.some((s) => s === '..')) {
    throw new AppError('IMPORT_PATH_TRAVERSAL', '壓縮檔內有路徑穿越（..）');
  }
  if (CONTROL_CHARS.test(normalized)) {
    throw new AppError('IMPORT_INVALID_ARCHIVE', '壓縮檔內有路徑含控制字元');
  }
  if (segments.length === 0) return { kind: 'dir' };
  if (segments[0] === '__MACOSX' || segments[segments.length - 1] === '.DS_Store') {
    return { kind: 'ignored' };
  }
  if (isDir) return { kind: 'dir' };
  const p = segments.join('/');
  if (!ALLOWED.has(extensionOf(p))) {
    throw new AppError('IMPORT_EXTENSION_NOT_ALLOWED', `不允許的檔案類型：${p}`, { path: p });
  }
  return { kind: 'file', path: p };
}

/** 若所有檔案都在同一個頂層資料夾內，去掉這一層。 */
export function stripCommonTopFolder<T extends { path: string }>(files: T[]): T[] {
  if (files.length === 0) return files;
  const first = files[0]!.path;
  const slash = first.indexOf('/');
  if (slash < 0) return files;
  const top = first.slice(0, slash + 1);
  if (!files.every((f) => f.path.startsWith(top))) return files;
  return files.map((f) => ({ ...f, path: f.path.slice(top.length) }));
}

/** 套用在所有匯入來源（zip／單檔／貼上）的最後驗證：至少要有一個 HTML 頁面。 */
export function finalizeEntries(files: BundleFile[]): BundleFile[] {
  const stripped = stripCommonTopFolder(files);
  if (!stripped.some((f) => isPagePath(f.path))) {
    throw new AppError('IMPORT_NO_HTML', '壓縮檔內沒有任何 HTML 頁面');
  }
  return stripped;
}
