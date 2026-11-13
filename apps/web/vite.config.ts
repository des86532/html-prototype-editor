import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';
import { buildAppCsp } from './csp';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, resolve(__dirname, '../..'), '');
  const contentBase = env.CONTENT_BASE_DOMAIN ?? 'content.localhost:5174';
  const apiOrigin = env.API_ORIGIN ?? 'http://localhost:5175';
  const csp = buildAppCsp({
    contentBaseDomain: contentBase,
    contentScheme: contentBase.includes('localhost') ? 'http' : 'https',
    apiOrigin,
  });
  const securityHeaders = {
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };
  // harness.html 是 security suite 專用入口（M1），存在才加入建置。
  const inputs: Record<string, string> = { main: resolve(__dirname, 'index.html') };
  if (existsSync(resolve(__dirname, 'harness.html')))
    inputs.harness = resolve(__dirname, 'harness.html');

  return {
    envDir: resolve(__dirname, '../..'),
    envPrefix: ['VITE_', 'APP_', 'API_', 'CONTENT_'],
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': resolve(__dirname, 'src') } },
    server: { port: 5173, strictPort: true },
    preview: { port: 5173, strictPort: true, headers: securityHeaders },
    build: { rollupOptions: { input: inputs } },
  };
});
