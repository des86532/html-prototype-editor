import { extname } from 'node:path';

/**
 * Content-Type 一律依副檔名決定（規格：不採用上傳時宣稱的 MIME）。
 * 只有副檔名白名單（ALLOWED_EXTENSIONS）內的檔案會被提供，其他副檔名回 null（→ 404）。
 */
const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  txt: 'text/plain; charset=utf-8',
  map: 'application/json; charset=utf-8',
};

export function extensionOf(path: string): string {
  return extname(path).slice(1).toLowerCase();
}

export function contentTypeFor(path: string): string | null {
  return TYPES[extensionOf(path)] ?? null;
}

export function isHtmlPath(path: string): boolean {
  const ext = extensionOf(path);
  return ext === 'html' || ext === 'htm';
}

/** 會被瀏覽器當成「文件」執行 script 的類型（需要 CSP sandbox header）。 */
export function isDocumentPath(path: string): boolean {
  return isHtmlPath(path) || extensionOf(path) === 'svg';
}
