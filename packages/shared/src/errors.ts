export const ERROR_CODES = [
  // 通用
  'BAD_REQUEST',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'INTERNAL',
  // 匯入（V17）
  'IMPORT_ARCHIVE_TOO_LARGE',
  'IMPORT_EXTRACTED_TOO_LARGE',
  'IMPORT_TOO_MANY_ENTRIES',
  'IMPORT_COMPRESSION_RATIO',
  'IMPORT_PATH_TRAVERSAL',
  'IMPORT_ABSOLUTE_PATH',
  'IMPORT_SYMLINK',
  'IMPORT_BACKSLASH_PATH',
  'IMPORT_NUL_IN_PATH',
  'IMPORT_EXTENSION_NOT_ALLOWED',
  'IMPORT_DUPLICATE_PATH',
  'IMPORT_NO_HTML',
  'IMPORT_INVALID_ARCHIVE',
  'IMPORT_ENTRY_REQUIRED',
  // 分享／留言
  'SHARE_REVOKED',
  'SHARE_EXPIRED',
  'SHARE_ROLE_FORBIDDEN',
  'GUEST_REQUIRED',
  // 協定
  'PROTOCOL_INVALID',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  IMPORT_ARCHIVE_TOO_LARGE: 413,
  IMPORT_EXTRACTED_TOO_LARGE: 413,
  IMPORT_TOO_MANY_ENTRIES: 422,
  IMPORT_COMPRESSION_RATIO: 422,
  IMPORT_PATH_TRAVERSAL: 422,
  IMPORT_ABSOLUTE_PATH: 422,
  IMPORT_SYMLINK: 422,
  IMPORT_BACKSLASH_PATH: 422,
  IMPORT_NUL_IN_PATH: 422,
  IMPORT_EXTENSION_NOT_ALLOWED: 422,
  IMPORT_DUPLICATE_PATH: 422,
  IMPORT_NO_HTML: 422,
  IMPORT_INVALID_ARCHIVE: 422,
  IMPORT_ENTRY_REQUIRED: 422,
  SHARE_REVOKED: 403,
  SHARE_EXPIRED: 403,
  SHARE_ROLE_FORBIDDEN: 403,
  GUEST_REQUIRED: 403,
  PROTOCOL_INVALID: 400,
};

/** 所有 API 錯誤回應的 JSON 形狀：`{ error: ApiErrorBody }`。 */
export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;
  constructor(code: ErrorCode, message?: string, details?: unknown) {
    super(message ?? code);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
  get status(): number {
    return ERROR_HTTP_STATUS[this.code];
  }
  toBody(): { error: ApiErrorBody } {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}
