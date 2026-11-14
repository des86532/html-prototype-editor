import { z } from 'zod';

/**
 * 主應用 CSP 帶有 `require-trusted-types-for 'script'` 且沒有 `unsafe-eval`：zod 4 預設會用
 * `new Function` 預先編譯 parser，這會被瀏覽器擋下並在 console 留下 CSP 錯誤。
 * 在受 CSP 限制的環境（主應用）啟動時呼叫一次，改用解譯模式。
 */
export function disableZodJit(): void {
  z.config({ jitless: true });
}
