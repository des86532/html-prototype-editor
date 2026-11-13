import { AppError } from '@hpe/shared';
import type { ZodType } from 'zod';

/** zod 驗證；失敗回 BAD_REQUEST 並附 issues。 */
export function parseWith<T>(schema: ZodType<T>, data: unknown, what = '請求內容'): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new AppError('BAD_REQUEST', `${what}格式不正確`, {
      issues: result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
        code: i.code,
      })),
    });
  }
  return result.data;
}

export function idParam(params: unknown): string {
  const id = (params as { id?: unknown } | undefined)?.id;
  if (typeof id !== 'string' || id.length === 0 || id.length > 512) {
    throw new AppError('BAD_REQUEST', '路徑參數不正確');
  }
  return id;
}
