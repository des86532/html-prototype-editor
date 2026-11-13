import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FsStorage } from './fs.js';
import { S3Storage, type S3Like } from './s3.js';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const text = async (r: Readable) => {
  const chunks: Buffer[] = [];
  for await (const c of r) chunks.push(Buffer.from(c as Uint8Array));
  return Buffer.concat(chunks).toString('utf8');
};

describe('FsStorage', () => {
  let root: string;
  let storage: FsStorage;
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'hpe-fs-'));
    storage = new FsStorage(root);
  });
  afterAll(() => rm(root, { recursive: true, force: true }));

  it('put/has/get/delete，內容定址且分層目錄', async () => {
    const data = Buffer.from('hello');
    const h = sha(data);
    expect(await storage.has(h)).toBe(false);
    await storage.put(h, data, data.length);
    expect(await storage.has(h)).toBe(true);
    expect(await text(await storage.get(h))).toBe('hello');
    expect(await readdir(path.join(root, h.slice(0, 2), h.slice(2, 4)))).toEqual([h]);
    await storage.delete(h);
    expect(await storage.has(h)).toBe(false);
    await expect(storage.get(h)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('stream 寫入會驗證雜湊與大小，失敗不留下檔案', async () => {
    const data = Buffer.from('stream-data');
    const h = sha(data);
    await expect(storage.put(h, Readable.from([Buffer.from('other')]), 5)).rejects.toThrow();
    expect(await storage.has(h)).toBe(false);
    await storage.put(h, Readable.from([data.subarray(0, 4), data.subarray(4)]), data.length);
    expect(await text(await storage.get(h))).toBe('stream-data');
    expect(await readdir(path.join(root, '.tmp'))).toEqual([]);
  });

  it('拒絕不合法的 key（避免路徑穿越）', async () => {
    await expect(storage.get('../../etc/passwd')).rejects.toThrow(/invalid sha256/);
    await expect(storage.has('abc')).rejects.toThrow(/invalid sha256/);
  });

  it('重複寫入是 no-op', async () => {
    const data = Buffer.from('dup');
    await storage.put(sha(data), data, data.length);
    await storage.put(sha(data), data, data.length);
    expect(await text(await storage.get(sha(data)))).toBe('dup');
  });
});

/** 以記憶體 Map 模擬 S3 client（真正的 S3/MinIO 在此環境無法測試）。 */
class FakeS3 implements S3Like {
  objects = new Map<string, Buffer>();
  commands: string[] = [];
  async send(command: unknown): Promise<unknown> {
    const c = command as { constructor: { name: string }; input: { Key: string; Body?: Buffer } };
    const name = c.constructor.name;
    this.commands.push(name);
    const key = c.input.Key;
    if (name === 'PutObjectCommand') {
      this.objects.set(key, c.input.Body!);
      return {};
    }
    const obj = this.objects.get(key);
    if (name === 'HeadObjectCommand' || name === 'GetObjectCommand') {
      if (!obj)
        throw Object.assign(new Error('nf'), {
          name: 'NotFound',
          $metadata: { httpStatusCode: 404 },
        });
      return name === 'GetObjectCommand' ? { Body: Readable.from([obj]) } : {};
    }
    if (name === 'DeleteObjectCommand') {
      this.objects.delete(key);
      return {};
    }
    throw new Error(`unexpected ${name}`);
  }
}

describe('S3Storage（fake client）', () => {
  it('put/has/get/delete，key 以 sha256 分層', async () => {
    const fake = new FakeS3();
    const s = new S3Storage(fake, 'bucket');
    const data = Buffer.from('s3-data');
    const h = sha(data);
    expect(await s.has(h)).toBe(false);
    await s.put(h, data, data.length);
    expect([...fake.objects.keys()]).toEqual([`blobs/${h.slice(0, 2)}/${h}`]);
    expect(await s.has(h)).toBe(true);
    expect(await text(await s.get(h))).toBe('s3-data');
    await s.put(h, data, data.length);
    expect(fake.commands.filter((x) => x === 'PutObjectCommand')).toHaveLength(1);
    await s.delete(h);
    expect(await s.has(h)).toBe(false);
    await expect(s.get(h)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('stream 內容雜湊不符時拒絕', async () => {
    const s = new S3Storage(new FakeS3(), 'bucket');
    await expect(
      s.put(sha(Buffer.from('a')), Readable.from([Buffer.from('b')]), 1),
    ).rejects.toThrow();
  });
});
