import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: 'content', environment: 'node', include: ['src/**/*.test.ts'] },
});
