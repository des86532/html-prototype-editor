import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: 'frame-agent', environment: 'jsdom', include: ['src/**/*.test.ts'] },
});
