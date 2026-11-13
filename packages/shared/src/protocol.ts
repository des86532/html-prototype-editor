import { MESSAGE_LIMITS } from './limits.js';
import { FrameToParentSchema, ParentToFrameSchema } from './schemas.js';
import type { FrameToParent, ParentToFrame } from './types.js';

export { FrameToParentSchema, ParentToFrameSchema };

export type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string };

/** 序列化後的位元組數（UTF-8）。無法序列化（循環參照等）視為超限。 */
export function messageByteSize(data: unknown): number {
  try {
    const json = JSON.stringify(data);
    if (json === undefined) return Infinity;
    return new TextEncoder().encode(json).length;
  } catch {
    return Infinity;
  }
}

/**
 * Parent 端第 2 步：先擋大小（> 64 KB 丟棄），再 zod 驗證。
 * 來源檢查（event.source === iframe.contentWindow）與頻率上限由 useFrameBridge 負責。
 */
export function parseFrameMessage(data: unknown): ParseResult<FrameToParent> {
  if (messageByteSize(data) > MESSAGE_LIMITS.maxBytes) return { ok: false, reason: 'too-large' };
  const r = FrameToParentSchema.safeParse(data);
  return r.success ? { ok: true, value: r.data } : { ok: false, reason: 'schema' };
}

/** agent 端：parent 傳來的訊息同樣驗證（防止其他 window 亂送）。 */
export function parseParentMessage(data: unknown): ParseResult<ParentToFrame> {
  if (messageByteSize(data) > MESSAGE_LIMITS.maxBytes) return { ok: false, reason: 'too-large' };
  const r = ParentToFrameSchema.safeParse(data);
  return r.success ? { ok: true, value: r.data } : { ok: false, reason: 'schema' };
}

/** token bucket：容量 = 每秒上限；`take()` 回傳是否放行。 */
export class TokenBucket {
  private tokens: number;
  private last: number;
  constructor(
    private readonly perSecond: number = MESSAGE_LIMITS.maxPerSecond,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.tokens = perSecond;
    this.last = now();
  }
  take(): boolean {
    const t = this.now();
    this.tokens = Math.min(this.perSecond, this.tokens + ((t - this.last) / 1000) * this.perSecond);
    this.last = t;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
