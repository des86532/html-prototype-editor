import { UPLOAD_LIMITS, type ErrorCode } from '@hpe/shared';
import { describe, expect, it } from 'vitest';
import { buildZip } from '../testing/zip.js';
import { DEFAULT_EXTRACT_LIMITS, extractZip, type ExtractLimits } from './extractZip.js';

const HTML = '<!doctype html><title>t</title>';

async function code(promise: Promise<unknown>): Promise<ErrorCode | 'OK'> {
  try {
    await promise;
    return 'OK';
  } catch (err) {
    return (err as { code: ErrorCode }).code;
  }
}

const extract = (zip: Buffer, limits?: Partial<ExtractLimits>) =>
  extractZip(zip, zip.length, { ...DEFAULT_EXTRACT_LIMITS, ...limits });

describe('extractZip: 正常情況', () => {
  it('解出檔案、NFC 正規化、去除單一頂層資料夾、忽略 macOS 垃圾檔', async () => {
    const decomposed = 'e\u0301.html'; // e + 組合重音
    const zip = buildZip({
      'proj/index.html': HTML,
      'proj/css/app.CSS': 'a{}',
      [`proj/${decomposed}`]: HTML,
      'proj/.DS_Store': 'junk',
      '__MACOSX/proj/._index.html': 'junk',
      'proj/img/': { data: '' },
    });
    const files = await extract(zip);
    expect(files.map((f) => f.path).sort()).toEqual(['css/app.CSS', 'index.html', '\u00e9.html']);
  });

  it('頂層有多個資料夾或根層檔案時不去除前綴', async () => {
    const files = await extract(buildZip({ 'index.html': HTML, 'a/b.css': 'x{}' }));
    expect(files.map((f) => f.path).sort()).toEqual(['a/b.css', 'index.html']);
  });

  it('副檔名白名單不分大小寫', async () => {
    const files = await extract(buildZip({ 'INDEX.HTML': HTML, 'logo.PNG': 'x' }));
    expect(files).toHaveLength(2);
  });
});

describe('extractZip: V17 惡意壓縮檔', () => {
  it('zip slip（../../x）', async () => {
    expect(await code(extract(buildZip({ 'index.html': HTML, '../../x.html': HTML })))).toBe(
      'IMPORT_PATH_TRAVERSAL',
    );
    expect(await code(extract(buildZip({ 'a/../../x.html': HTML })))).toBe('IMPORT_PATH_TRAVERSAL');
  });

  it('絕對路徑（unix 與 Windows 磁碟機）', async () => {
    expect(await code(extract(buildZip({ '/etc/passwd.txt': 'x' })))).toBe('IMPORT_ABSOLUTE_PATH');
    expect(await code(extract(buildZip({ 'C:/x.html': HTML })))).toBe('IMPORT_ABSOLUTE_PATH');
  });

  it('反斜線', async () => {
    expect(await code(extract(buildZip({ 'a\\b.html': HTML })))).toBe('IMPORT_BACKSLASH_PATH');
    expect(await code(extract(buildZip({ '..\\x.html': HTML })))).toBe('IMPORT_BACKSLASH_PATH');
  });

  it('NUL 字元', async () => {
    expect(await code(extract(buildZip({ 'index.html\0.png': HTML })))).toBe('IMPORT_NUL_IN_PATH');
  });

  it('symlink（即使副檔名在白名單內）', async () => {
    const zip = buildZip({
      'index.html': HTML,
      'link.html': { data: '/etc/passwd', mode: 0o120777 },
    });
    expect(await code(extract(zip))).toBe('IMPORT_SYMLINK');
  });

  it('一般檔案的 mode 不會被誤判成 symlink', async () => {
    const zip = buildZip({ 'index.html': { data: HTML, mode: 0o100644 } });
    expect(await code(extract(zip))).toBe('OK');
  });

  it('不在白名單的副檔名（含無副檔名、.exe、.php）', async () => {
    for (const name of ['evil.exe', 'run.php', 'Makefile', 'a.html.exe', 'x.SH']) {
      expect(await code(extract(buildZip({ 'index.html': HTML, [name]: 'x' })))).toBe(
        'IMPORT_EXTENSION_NOT_ALLOWED',
      );
    }
  });

  it('NFC 正規化後重複的路徑', async () => {
    const zip = buildZip({ 'index.html': HTML, '\u00e9.css': 'a{}', 'e\u0301.css': 'b{}' });
    expect(await code(extract(zip))).toBe('IMPORT_DUPLICATE_PATH');
  });

  it('沒有任何 HTML 頁面', async () => {
    expect(await code(extract(buildZip({ 'a.css': 'x{}' })))).toBe('IMPORT_NO_HTML');
  });

  it('不是 zip', async () => {
    expect(await code(extractZip(Buffer.from('not a zip at all'), 16))).toBe(
      'IMPORT_INVALID_ARCHIVE',
    );
  });

  it('壓縮檔過大', async () => {
    const zip = buildZip({ 'index.html': HTML });
    expect(await code(extract(zip, { maxArchiveBytes: zip.length - 1 }))).toBe(
      'IMPORT_ARCHIVE_TOO_LARGE',
    );
  });

  it('檔案數超過上限（實際 2001 個項目 > 2000）', async () => {
    const entries: Record<string, string> = { 'index.html': HTML };
    for (let i = 0; i < UPLOAD_LIMITS.maxEntries; i += 1) entries[`f${i}.txt`] = 'x';
    expect(await code(extract(buildZip(entries)))).toBe('IMPORT_TOO_MANY_ENTRIES');
  });

  it('zip bomb：極高壓縮比的單檔被拒絕（體積很小的 zip）', async () => {
    const bomb = buildZip({
      'index.html': HTML,
      'big.txt': { data: new Uint8Array(20 * 1024 * 1024), level: 9 },
    });
    expect(bomb.length).toBeLessThan(100 * 1024);
    expect(await code(extract(bomb))).toBe('IMPORT_COMPRESSION_RATIO');
  });

  it('解壓後總量超過上限（以實際膨脹位元組計，不看 header）', async () => {
    // 每個檔案壓縮比低於 100:1，但加總超過上限
    const noisy = new Uint8Array(64 * 1024);
    let x = 123456789;
    for (let i = 0; i < noisy.length; i += 1) {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      noisy[i] = x >>> 16;
    }
    const zip = buildZip({
      'index.html': HTML,
      'a.txt': { data: noisy },
      'b.txt': { data: noisy },
      'c.txt': { data: noisy },
    });
    expect(await code(extract(zip, { maxExtractedBytes: 150 * 1024 }))).toBe(
      'IMPORT_EXTRACTED_TOO_LARGE',
    );
    expect(await code(extract(zip, { maxExtractedBytes: 300 * 1024 }))).toBe('OK');
  });

  it('壓縮比：極小的檔案不受影響', async () => {
    expect(await code(extract(buildZip({ 'index.html': HTML, 'e.json': '{}' })))).toBe('OK');
  });
});
