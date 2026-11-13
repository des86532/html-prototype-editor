import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { AppError } from '@hpe/shared';
import type { S3Config } from '../config.js';
import { assertSha256, type StorageAdapter } from './types.js';

/** 只用到 `send` 的最小 client 介面，方便以 fake 測試。 */
export interface S3Like {
  send(command: unknown): Promise<unknown>;
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
}

export class S3Storage implements StorageAdapter {
  constructor(
    private readonly client: S3Like,
    private readonly bucket: string,
  ) {}

  static fromConfig(cfg: S3Config): S3Storage {
    const client = new S3Client({
      region: cfg.region,
      ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
      // MinIO 需要 path-style
      forcePathStyle: true,
      credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
    });
    return new S3Storage(client, cfg.bucket);
  }

  private key(sha256: string): string {
    assertSha256(sha256);
    return `blobs/${sha256.slice(0, 2)}/${sha256}`;
  }

  async has(sha256: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.key(sha256) }));
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }

  async put(sha256: string, data: Buffer | Readable, size: number): Promise<void> {
    const key = this.key(sha256);
    let body: Buffer;
    if (Buffer.isBuffer(data)) {
      body = data;
    } else {
      // S3 PutObject 需要已知長度；串流先收齊再驗證雜湊（單檔上限 20 MB 內）。
      const chunks: Buffer[] = [];
      for await (const chunk of data) chunks.push(Buffer.from(chunk as Uint8Array));
      body = Buffer.concat(chunks);
      if (body.length !== size || createHash('sha256').update(body).digest('hex') !== sha256) {
        throw new Error('storage: content does not match sha256/size');
      }
    }
    if (await this.has(sha256)) return;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentLength: body.length,
        ContentType: 'application/octet-stream',
      }),
    );
  }

  async get(sha256: string): Promise<Readable> {
    try {
      const res = (await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.key(sha256) }),
      )) as { Body?: unknown };
      const body = res.Body;
      if (body instanceof Readable) return body;
      if (
        body &&
        typeof (body as { transformToByteArray?: unknown }).transformToByteArray === 'function'
      ) {
        const bytes = await (
          body as { transformToByteArray(): Promise<Uint8Array> }
        ).transformToByteArray();
        return Readable.from([Buffer.from(bytes)]);
      }
      throw new AppError('NOT_FOUND');
    } catch (err) {
      if (isNotFound(err)) throw new AppError('NOT_FOUND');
      throw err;
    }
  }

  async delete(sha256: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(sha256) }));
  }
}
