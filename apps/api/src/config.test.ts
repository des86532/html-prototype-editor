import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const base = { SESSION_SECRET: 'x'.repeat(32) };

describe('loadConfig 登入設定', () => {
  it('沒有 Google 也沒有 DEV_LOGIN → 啟動失敗', () => {
    expect(() => loadConfig(base)).toThrow(
      'DEV_LOGIN=false 時必須設定 GOOGLE_CLIENT_ID 與 GOOGLE_CLIENT_SECRET',
    );
  });

  it('production 禁止 DEV_LOGIN', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', DEV_LOGIN: 'true' })).toThrow(
      'DEV_LOGIN=true 不可用於 NODE_ENV=production',
    );
  });

  it('只設定 Google 的其中一個值 → 啟動失敗', () => {
    expect(() => loadConfig({ ...base, GOOGLE_CLIENT_ID: 'id', DEV_LOGIN: 'true' })).toThrow(
      '必須同時設定 GOOGLE_CLIENT_ID 與 GOOGLE_CLIENT_SECRET',
    );
  });

  it('兩個 Google 值都有 → google 設定生效，devLogin 預設關閉', () => {
    const c = loadConfig({ ...base, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's' });
    expect(c.google).toEqual({ clientId: 'id', clientSecret: 's' });
    expect(c.devLogin).toBe(false);
  });
});
