import { zipSync, type Zippable } from 'fflate';

export interface ZipEntrySpec {
  data: Uint8Array | string;
  /** 解壓後 unix mode（含檔案類型位元），例如 0o120777 = symlink */
  mode?: number;
  level?: number;
}

/** 測試用：以 fflate 組出（可能惡意的）zip。檔名原樣寫入，不做任何清理。 */
export function buildZip(entries: Record<string, ZipEntrySpec | string>): Buffer {
  const z: Zippable = {};
  for (const [name, spec] of Object.entries(entries)) {
    const s: ZipEntrySpec = typeof spec === 'string' ? { data: spec } : spec;
    const bytes = typeof s.data === 'string' ? new TextEncoder().encode(s.data) : s.data;
    z[name] = [
      bytes,
      {
        level: (s.level ?? 6) as 0 | 6 | 9,
        ...(s.mode !== undefined ? { os: 3, attrs: (s.mode << 16) >>> 0 } : {}),
      },
    ];
  }
  return Buffer.from(zipSync(z));
}

export function multipartBody(
  parts: { name: string; value?: string; filename?: string; data?: Buffer; contentType?: string }[],
): { body: Buffer; contentType: string } {
  const boundary = `----hpeTest${Math.random().toString(16).slice(2)}`;
  const chunks: Buffer[] = [];
  for (const p of parts) {
    let head = `--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"`;
    if (p.filename !== undefined) head += `; filename="${p.filename}"`;
    head += '\r\n';
    if (p.contentType) head += `Content-Type: ${p.contentType}\r\n`;
    head += '\r\n';
    chunks.push(Buffer.from(head), p.data ?? Buffer.from(p.value ?? ''), Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}
