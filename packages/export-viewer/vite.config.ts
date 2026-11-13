import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { defineConfig } from 'vite';

const webSrc = resolve(import.meta.dirname, '../../apps/web/src');

const aliases = [
  // apps/web 的元件內部用 `@/…`，shell 自己的程式碼用 `@web/…`；兩者都指向 web 的 src（唯讀重用）。
  { find: /^@\//, replacement: `${webSrc}/` },
  { find: /^@web\//, replacement: `${webSrc}/` },
  {
    find: '@hpe/exporter/browser',
    replacement: resolve(import.meta.dirname, '../exporter/src/browser.ts'),
  },
];

/** 單檔 shell：所有 JS／CSS inline 進 dist/index.html；不產生任何外部請求。 */
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: { alias: aliases, dedupe: ['react', 'react-dom'] },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    modulePreload: false,
    reportCompressedSize: true,
  },
});
