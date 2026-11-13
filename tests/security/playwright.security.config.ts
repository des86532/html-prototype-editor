import { defineConfig } from '@playwright/test';
import base from '../../playwright.config';

/**
 * Security suite（M1 門檻）：
 *   pnpm exec playwright test -c tests/security/playwright.security.config.ts [--project=chromium|firefox|webkit]
 * 沿用根設定的瀏覽器矩陣；evil server、content server、harness 由 worker 範圍的 fixture 啟動
 * （見 fixtures.ts／servers.ts），所以直接用根設定跑 `tests/` 也會得到相同結果。
 */
export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  reporter: [['list']],
  // trace 的 DOM snapshot 會對每個 frame 執行腳本；V10 把 frame 卡死時，snapshot 會永遠等不到回應。
  use: { ...base.use, trace: 'off' },
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: '../../test-results/security',
  projects: (base.projects ?? []).map((p) =>
    p.name === 'chromium'
      ? {
          ...p,
          // 規格 D1 的前提：prototype 在獨立 site → 獨立 process（V10 要求 frame 卡死時主應用不受影響）。
          // 一般桌面 Chrome 預設就是 site isolation；Playwright 的 headless 建置不一定，所以明確開啟。
          use: { ...p.use, trace: 'off', launchOptions: { args: ['--site-per-process'] } },
        }
      : p.name === 'firefox'
        ? {
            ...p,
            use: {
              ...p.use,
              trace: 'off',
              launchOptions: {
                firefoxUserPrefs: {
                  'fission.autostart': true,
                  'fission.webContentIsolationStrategy': 1,
                },
              },
            },
          }
        : p,
  ),
});
