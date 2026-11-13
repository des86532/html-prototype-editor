export interface NormalizedPath {
  /** NFC 正規化、無前導 `/` 的 bundle 路徑；空字串 = 根目錄 */
  path: string;
  /** 請求以 `/` 結尾（或根目錄）→ 要找 index.html */
  isDir: boolean;
}

// 控制字元（含 NUL）與反斜線
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\u0000-\u001f\u007f\\]/;

/**
 * 把請求的 raw URL（`req.url`）正規化成 bundle 內的路徑。
 * 不用 `new URL()`：`//evil/x` 這種開頭會被當成 host-relative。
 * 拒絕（回傳 null → 404）：`..` 片段（含 %2e%2e）、NUL／控制字元、反斜線（含 %5c）、壞掉的 percent-encoding。
 */
export function normalizeRequestPath(rawUrl: string): NormalizedPath | null {
  const cut = rawUrl.search(/[?#]/);
  const rawPath = cut < 0 ? rawUrl : rawUrl.slice(0, cut);
  if (!rawPath.startsWith('/')) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  if (FORBIDDEN.test(decoded)) return null;
  decoded = decoded.normalize('NFC');
  const segments: string[] = [];
  for (const seg of decoded.split('/')) {
    if (seg === '..') return null;
    if (seg === '' || seg === '.') continue;
    segments.push(seg);
  }
  const isDir = decoded.endsWith('/') || segments.length === 0;
  return { path: segments.join('/'), isDir };
}
