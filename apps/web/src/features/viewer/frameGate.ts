import { MESSAGE_LIMITS, TokenBucket, parseFrameMessage, type FrameToParent } from '@hpe/shared';

export type GateVerdict =
  | { ok: true; message: FrameToParent }
  | { ok: false; reason: 'foreign-source' | 'too-large' | 'schema' | 'rate-limited' };

/**
 * Parent 端訊息處理規則 1–3（規格「Parent 端訊息處理規則」）：
 *  1. 只接受 `event.source === iframe.contentWindow`（opaque origin 的 event.origin 是 "null"，不能拿 origin 判斷）
 *  2. 先擋大小（> 64 KB 丟棄），再 zod safeParse
 *  3. token bucket 120 則/秒
 * 純函式 + 可注入時鐘，方便單元測試。
 */
export class FrameGate {
  private readonly bucket: TokenBucket;
  private rateLimitedUntil = 0;
  constructor(
    private readonly getSource: () => unknown,
    private readonly now: () => number = () => Date.now(),
    perSecond: number = MESSAGE_LIMITS.maxPerSecond,
  ) {
    this.bucket = new TokenBucket(perSecond, now);
  }

  /** 超過頻率上限後暫停處理一小段時間，避免 10,000 則/秒把主執行緒拖垮。 */
  static readonly COOLDOWN_MS = 1000;

  check(event: { source: unknown; data: unknown }): GateVerdict {
    const source = this.getSource();
    if (source == null || event.source !== source) return { ok: false, reason: 'foreign-source' };
    const t = this.now();
    if (t < this.rateLimitedUntil) return { ok: false, reason: 'rate-limited' };
    if (!this.bucket.take()) {
      this.rateLimitedUntil = t + FrameGate.COOLDOWN_MS;
      return { ok: false, reason: 'rate-limited' };
    }
    const parsed = parseFrameMessage(event.data);
    if (!parsed.ok)
      return { ok: false, reason: parsed.reason === 'too-large' ? 'too-large' : 'schema' };
    return { ok: true, message: parsed.value };
  }
}
