import { MESSAGE_LIMITS, PROTOCOL_VERSION, type ParentToFrame } from '@hpe/shared';

/**
 * agent 專用的輕量 `ParentToFrame` 驗證。
 * 為什麼不直接用 `parseParentMessage`：它依賴完整的 zod schema，打包後約 95 KB gzip，
 * 遠超過 agent 15 KB 的預算。這裡手寫等價的結構檢查（`validate.test.ts` 以 zod schema 做對照測試）。
 * parent 是受信任端，這層只防「其他 window 亂送」；真正的 schema 邊界在 parent（D5）。
 */

export type LiteResult = { ok: true; value: ParentToFrame } | { ok: false };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown, max: number, min = 0): v is string =>
  typeof v === 'string' && v.length >= min && v.length <= max;
function byteSize(data: unknown): number {
  try {
    const json = JSON.stringify(data);
    return json === undefined ? Infinity : new TextEncoder().encode(json).length;
  } catch {
    return Infinity;
  }
}

export function parseParentMessageLite(data: unknown): LiteResult {
  if (!isObj(data) || data.v !== PROTOCOL_VERSION) return { ok: false };
  if (byteSize(data) > MESSAGE_LIMITS.maxBytes) return { ok: false };
  let valid = false;
  switch (data.type) {
    case 'init':
      valid =
        data.storageSeed === undefined ||
        isStr(data.storageSeed, MESSAGE_LIMITS.maxStorageBlobBytes);
      break;
    case 'scrollTo':
      valid = isNum(data.x) && isNum(data.y);
      break;
    case 'scrollBy':
      valid = isNum(data.dx) && isNum(data.dy);
      break;
    case 'ping':
      valid = Number.isInteger(data.seq);
      break;
  }
  return valid ? { ok: true, value: data as unknown as ParentToFrame } : { ok: false };
}
