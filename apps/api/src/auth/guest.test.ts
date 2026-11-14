import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../plugins/rateLimit.js';
import { DEFAULT_RATE_LIMITS } from '../config.js';
import { base32Lower, newContentKey } from '../ids.js';
import { signGuestToken, verifyGuestToken } from './guest.js';

const SECRET = 's'.repeat(40);

describe('guest token', () => {
  const claims = { gid: 'G1', name: '小明', pid: 'P1' };

  it('簽章後可驗證', () => {
    expect(verifyGuestToken(signGuestToken(claims, SECRET), SECRET)).toEqual(claims);
  });
  it('竄改 payload、換 secret、格式錯誤都失敗', () => {
    const token = signGuestToken(claims, SECRET);
    const [payload, sig] = token.split('.') as [string, string];
    const forged = Buffer.from(JSON.stringify({ ...claims, pid: 'P2' })).toString('base64url');
    expect(verifyGuestToken(`${forged}.${sig}`, SECRET)).toBeNull();
    expect(verifyGuestToken(token, 'x'.repeat(40))).toBeNull();
    expect(verifyGuestToken(payload, SECRET)).toBeNull();
    expect(verifyGuestToken(`${payload}.`, SECRET)).toBeNull();
    expect(verifyGuestToken('a.b.c', SECRET)).toBeNull();
    expect(verifyGuestToken('', SECRET)).toBeNull();
  });
});

describe('ids', () => {
  it('contentKey 為 26 字元 base32 小寫', () => {
    for (let i = 0; i < 50; i += 1) expect(newContentKey()).toMatch(/^[a-z2-7]{26}$/);
    expect(new Set(Array.from({ length: 200 }, newContentKey)).size).toBe(200);
  });
  it('base32 編碼正確', () => {
    expect(base32Lower(Buffer.from('foobar'))).toBe('mzxw6ytboi');
  });
});

describe('RateLimiter', () => {
  it('token bucket：耗盡後拒絕，隨時間補充，不同 key 互不影響', () => {
    let t = 0;
    const limiter = new RateLimiter(
      { ...DEFAULT_RATE_LIMITS, guestIdentity: { capacity: 2, refillPerSecond: 1 } },
      () => t,
    );
    expect(limiter.take('guestIdentity', 'a')).toBeNull();
    expect(limiter.take('guestIdentity', 'a')).toBeNull();
    expect(limiter.take('guestIdentity', 'a')).toBe(1);
    expect(limiter.take('guestIdentity', 'b')).toBeNull();
    t = 1000;
    expect(limiter.take('guestIdentity', 'a')).toBeNull();
    expect(limiter.take('guestIdentity', 'a')).not.toBeNull();
  });
});
