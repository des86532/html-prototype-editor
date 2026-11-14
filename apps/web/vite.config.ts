import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { buildAppCsp } from './csp';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, resolve(import.meta.dirname, '../..'), '');
  const contentBase =
    env.VITE_CONTENT_BASE_DOMAIN ?? env.CONTENT_BASE_DOMAIN ?? 'content.localhost:5174';
  const apiOrigin = env.VITE_API_ORIGIN ?? env.API_ORIGIN ?? 'http://localhost:5175';
  const csp = buildAppCsp({
    contentBaseDomain: contentBase,
    contentScheme: contentBase.includes('localhost') ? 'http' : 'https',
    // 相對路徑（例如 /api）是同源，已被 'self' 涵蓋
    ...(apiOrigin.startsWith('/') ? {} : { apiOrigin }),
  });
  const securityHeaders = {
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };
  // Cloudflare Pages 以 `_headers` 檔套用回應標頭；與 `vite preview` 共用同一組，避免兩邊漂移。
  const pagesHeaders: Plugin = {
    name: 'pages-headers',
    generateBundle() {
      const lines = Object.entries(securityHeaders).map(([k, v]) => `  ${k}: ${v}`);
      this.emitFile({ type: 'asset', fileName: '_headers', source: `/*\n${lines.join('\n')}\n` });
    },
  };
  // harness.html 是 security suite 專用入口（M1），存在才加入建置。
  const inputs: Record<string, string> = { main: resolve(import.meta.dirname, 'index.html') };
  if (existsSync(resolve(import.meta.dirname, 'harness.html')))
    inputs.harness = resolve(import.meta.dirname, 'harness.html');

  return {
    envDir: resolve(import.meta.dirname, '../..'),
    envPrefix: ['VITE_', 'APP_', 'API_', 'CONTENT_'],
    plugins: [react(), tailwindcss(), pagesHeaders],
    resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
    server: { port: 5173, strictPort: true },
    preview: { port: 5173, strictPort: true, headers: securityHeaders },
    build: { rollupOptions: { input: inputs } },
  };
});
