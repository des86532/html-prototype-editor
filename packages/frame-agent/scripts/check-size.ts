import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { AGENT_MAX_GZIP_BYTES } from '@hpe/shared';

const file = resolve(import.meta.dirname, '../dist/agent.v1.js');
const gz = gzipSync(readFileSync(file), { level: 9 }).length;
console.log(`agent.v1.js gzip = ${gz} B (limit ${AGENT_MAX_GZIP_BYTES} B)`);
if (gz > AGENT_MAX_GZIP_BYTES) {
  console.error('frame-agent bundle exceeds the gzip budget');
  process.exit(1);
}
