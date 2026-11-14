import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';
import { buildAppCsp } from './csp';

/**
 * security suite 專用：只建置 `harness.html`（不依賴主應用入口能否編譯）到 `dist-harness`，
 * 並用與 `vite.config.ts` preview 相同的嚴格 CSP／header 提供服務。
 *   vite build   --config vite.harness.config.ts
 *   vite preview --config vite.harness.config.ts
 * 埠號可用 `HARNESS_PORT` 覆寫（預設 5173，與主應用相同，因為 content server 的
 * `frame-ancestors` 只允許 APP_ORIGIN）。
 */
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, resolve(import.meta.dirname, '../..'), ''), ...process.env };
  const contentBase = env.CONTENT_BASE_DOMAIN ?? 'content.localhost:5174';
  const apiOrigin = env.API_ORIGIN ?? 'http://localhost:5175';
  const csp = buildAppCsp({
    contentBaseDomain: contentBase,
    contentScheme: contentBase.includes('localhost') ? 'http' : 'https',
    apiOrigin,
  });
  return {
    root: import.meta.dirname,
    appType: 'mpa',
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
    build: {
      outDir: 'dist-harness',
      emptyOutDir: true,
      rollupOptions: { input: resolve(import.meta.dirname, 'harness.html') },
    },
    preview: {
      port: Number(env.HARNESS_PORT ?? 5173),
      strictPort: true,
      headers: {
        'Content-Security-Policy': csp,
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      },
    },
  };
});
