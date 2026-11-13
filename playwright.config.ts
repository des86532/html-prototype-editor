import { defineConfig, devices } from '@playwright/test';

/**
 * 三種瀏覽器都要跑（規格 Verification 1）。webServer 由各 suite 的 globalSetup／fixtures 啟動
 * （見 tests/security、tests/e2e），因為需要 evil server 與 fixture content server。
 */
export default defineConfig({
  testDir: 'tests',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
