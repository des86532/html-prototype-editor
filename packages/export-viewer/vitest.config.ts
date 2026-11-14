import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const webSrc = resolve(import.meta.dirname, '../../apps/web/src');

// 與 vite.config.ts 相同的別名（vitest 的 native config loader 不能跨檔解析 .ts）。
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${webSrc}/` },
      { find: /^@web\//, replacement: `${webSrc}/` },
      {
        find: '@hpe/exporter/browser',
        replacement: resolve(import.meta.dirname, '../exporter/src/browser.ts'),
      },
    ],
    dedupe: ['react', 'react-dom'],
  },
  test: { name: 'export-viewer', environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'] },
});
