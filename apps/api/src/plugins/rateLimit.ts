import type { FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { API_HEADERS, AppError } from '@hpe/shared';
import type { RateLimitConfig, RateLimitName } from '../config.js';
import { sha256Hex } from '../ids.js';

interface Bucket {
  tokens: number;
  last: number;
}

/** 記憶體 token bucket；key = 規則名稱 + IP + shareToken 雜湊。單一 process 有效。 */
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private ops = 0;

  constructor(
    private readonly rules: RateLimitConfig,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** 回傳 null 代表放行，否則回傳建議的 Retry-After（秒）。 */
  take(name: RateLimitName, key: string): number | null {
    const rule = this.rules[name];
    const t = this.now();
    const k = `${name}|${key}`;
    const b = this.buckets.get(k) ?? { tokens: rule.capacity, last: t };
    b.tokens = Math.min(rule.capacity, b.tokens + ((t - b.last) / 1000) * rule.refillPerSecond);
    b.last = t;
    this.buckets.set(k, b);
    if (++this.ops % 512 === 0) this.sweep(t);
    if (b.tokens < 1) {
      return Math.max(1, Math.ceil((1 - b.tokens) / rule.refillPerSecond));
    }
    b.tokens -= 1;
    return null;
  }

  private sweep(t: number): void {
    for (const [k, b] of this.buckets) {
      const name = k.slice(0, k.indexOf('|')) as RateLimitName;
      const rule = this.rules[name];
      // 已經補滿的 bucket 等同不存在
      if (b.tokens + ((t - b.last) / 1000) * rule.refillPerSecond >= rule.capacity) {
        this.buckets.delete(k);
      }
    }
  }
}

export function rateLimitKey(req: FastifyRequest): string {
  const header = req.headers[API_HEADERS.shareToken];
  const params = req.params as { id?: string } | undefined;
  const raw =
    typeof header === 'string' ? header : req.url.startsWith('/share/') ? params?.id : undefined;
  return `${req.ip}|${raw ? sha256Hex(raw).slice(0, 16) : ''}`;
}

/** 超過限制時丟出 RATE_LIMITED（429）並帶 Retry-After。 */
export function rateLimit(limiter: RateLimiter, name: RateLimitName): preHandlerAsyncHookHandler {
  return async (req, reply) => {
    const retry = limiter.take(name, rateLimitKey(req));
    if (retry !== null) {
      void reply.header('retry-after', String(retry));
      throw new AppError('RATE_LIMITED', '請求過於頻繁，請稍後再試', { retryAfterSeconds: retry });
    }
  };
}
