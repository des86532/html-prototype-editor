import type { Config } from '../config.js';
import { FsStorage } from './fs.js';
import { S3Storage } from './s3.js';
import type { StorageAdapter } from './types.js';

export type { StorageAdapter } from './types.js';
export { FsStorage } from './fs.js';
export { S3Storage } from './s3.js';

export function createStorage(config: Config): StorageAdapter {
  return config.storageDriver === 's3'
    ? S3Storage.fromConfig(config.s3)
    : new FsStorage(config.storageFsRoot);
}
