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
const isId = (v: unknown): v is string => isStr(v, 64, 1);
const isRect = (v: unknown): boolean =>
  isObj(v) && isNum(v.x) && isNum(v.y) && isNum(v.w) && isNum(v.h);
const isPoint = (v: unknown): boolean => isObj(v) && isNum(v.x) && isNum(v.y);
const isMode = (v: unknown): boolean => v === 'interact' || v === 'comment';
const optStr = (v: unknown, max: number): boolean => v === undefined || isStr(v, max);

function isAnchor(a: unknown): boolean {
  if (!isObj(a)) return false;
  const { viewport, selectors, snapshot } = a;
  if (!isStr(a.pageId, 512, 1)) return false;
  if (a.kind !== 'element' && a.kind !== 'region' && a.kind !== 'text') return false;
  if (!isObj(viewport) || !isNum(viewport.width) || !isNum(viewport.height) || !isNum(viewport.dpr))
    return false;
  if (!isObj(selectors) || !isObj(selectors.fingerprint) || !isPoint(selectors.elementOffset))
    return false;
  const sel = MESSAGE_LIMITS.maxSelectorLength;
  if (!optStr(selectors.css, sel) || !optStr(selectors.xpath, sel)) return false;
  const q = selectors.textQuote;
  if (
    q !== undefined &&
    !(isObj(q) && isStr(q.exact, 256) && isStr(q.prefix, 32) && isStr(q.suffix, 32))
  )
    return false;
  const d = selectors.dataAttr;
  if (d !== undefined && !(isObj(d) && isStr(d.name, 128) && isStr(d.value, 256))) return false;
  const rs = selectors.regionSize;
  if (rs !== undefined && !(isObj(rs) && isNum(rs.w) && isNum(rs.h))) return false;
  const f = selectors.fingerprint;
  if (!isStr(f.tag, 64) || !isStr(f.textHash, 64) || !Array.isArray(f.classes)) return false;
  if (f.classes.length > 64 || !f.classes.every((c) => isStr(c, 128))) return false;
  if (!Number.isInteger(f.siblingIndex) || !Number.isInteger(f.depth)) return false;
  return (
    isRect(a.fallback) &&
    isObj(snapshot) &&
    isStr(snapshot.tag, 64) &&
    isStr(snapshot.text, MESSAGE_LIMITS.maxSnapshotTextLength)
  );
}

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
        isMode(data.mode) &&
        (data.storageSeed === undefined ||
          isStr(data.storageSeed, MESSAGE_LIMITS.maxStorageBlobBytes));
      break;
    case 'setMode':
      valid = isMode(data.mode);
      break;
    case 'resolveAnchors':
      valid =
        isStr(data.requestId, 64) &&
        Array.isArray(data.anchors) &&
        data.anchors.length <= MESSAGE_LIMITS.maxAnchorsPerRequest &&
        data.anchors.every((x) => isObj(x) && isId(x.threadId) && isAnchor(x.anchor));
      break;
    case 'trackAnchors':
      valid =
        Array.isArray(data.threadIds) &&
        data.threadIds.length <= MESSAGE_LIMITS.maxAnchorsPerRequest &&
        data.threadIds.every(isId);
      break;
    case 'scrollToAnchor':
      valid = isId(data.threadId);
      break;
    case 'describeAt':
      valid = isStr(data.requestId, 64) && isPoint(data.point);
      break;
    case 'ping':
      valid = Number.isInteger(data.seq);
      break;
  }
  return valid ? { ok: true, value: data as unknown as ParentToFrame } : { ok: false };
}
