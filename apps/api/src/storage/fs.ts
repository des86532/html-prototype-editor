import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AppError } from '@hpe/shared';
import { assertSha256, type StorageAdapter } from './types.js';

/** 本機檔案系統：`<root>/ab/cd/<sha256>`，先寫暫存檔再 rename（原子）。 */
export class FsStorage implements StorageAdapter {
  constructor(private readonly root: string) {}

  private pathFor(sha256: string): string {
    assertSha256(sha256);
    return path.join(this.root, sha256.slice(0, 2), sha256.slice(2, 4), sha256);
  }

  async has(sha256: string): Promise<boolean> {
    try {
      return (await stat(this.pathFor(sha256))).isFile();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw err;
    }
  }

  async put(sha256: string, data: Buffer | Readable, size: number): Promise<void> {
    const dest = this.pathFor(sha256);
    if (await this.has(sha256)) {
      if (data instanceof Readable) data.resume();
      return;
    }
    await mkdir(path.dirname(dest), { recursive: true });
    const tmpDir = path.join(this.root, '.tmp');
    await mkdir(tmpDir, { recursive: true });
    const tmp = path.join(tmpDir, `${sha256}.${randomUUID()}`);
    try {
      if (Buffer.isBuffer(data)) {
        await writeFile(tmp, data);
      } else {
        const hash = createHash('sha256');
        let written = 0;
        const meter = new Transform({
          transform(chunk: Buffer, _enc, cb) {
            hash.update(chunk);
            written += chunk.length;
            cb(null, chunk);
          },
        });
        await pipeline(data, meter, createWriteStream(tmp));
        if (written !== size || hash.digest('hex') !== sha256) {
          throw new Error('storage: content does not match sha256/size');
        }
      }
      await rename(tmp, dest);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
  }

  async get(sha256: string): Promise<Readable> {
    const file = this.pathFor(sha256);
    try {
      await stat(file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new AppError('NOT_FOUND');
      throw err;
    }
    return createReadStream(file);
  }

  async delete(sha256: string): Promise<void> {
    await rm(this.pathFor(sha256), { force: true });
  }
}
