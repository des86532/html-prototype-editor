import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: 'anchoring', environment: 'jsdom', include: ['src/**/*.test.ts'] },
});
