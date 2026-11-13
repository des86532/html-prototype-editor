import { mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const root = import.meta.dirname;
const outfile = resolve(root, 'dist/agent.v1.js');
mkdirSync(resolve(root, 'dist'), { recursive: true });

await build({
  entryPoints: [resolve(root, 'src/index.ts')],
  outfile,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  minify: true,
  legalComments: 'none',
  treeShaking: true,
  logLevel: 'warning',
});

const raw = statSync(outfile).size;
const gz = gzipSync(readFileSync(outfile), { level: 9 }).length;
console.log(`agent.v1.js: ${raw} B raw, ${gz} B gzip`);
