import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Api } from '@/lib/api';
import { apiBaseUrl } from '@/lib/apiClient';
import { LoginPage } from './LoginPage';

afterEach(cleanup);

function setup(props: { devLogin?: ReturnType<typeof vi.fn>; error?: string } = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const api = { devLogin: props.devLogin ?? vi.fn() } as unknown as Api;
  render(
    <QueryClientProvider client={qc}>
      <LoginPage api={api} error={props.error} />
    </QueryClientProvider>,
  );
}

describe('LoginPage', () => {
  const original = window.location;
  afterEach(() => {
    Object.defineProperty(window, 'location', { value: original, configurable: true });
  });

  it('Google 登入連結指向 API 的 /auth/google', () => {
    setup();
    expect(screen.getByRole('link', { name: '使用 Google 登入' })).toHaveAttribute(
      'href',
      `${apiBaseUrl()}/auth/google`,
    );
  });

  it('依 error 代碼顯示訊息，未知代碼用預設訊息', () => {
    setup({ error: 'google_denied' });
    expect(screen.getByRole('alert')).toHaveTextContent('已取消 Google 登入。');
    cleanup();
    setup({ error: 'weird' });
    expect(screen.getByRole('alert')).toHaveTextContent('Google 登入失敗，請稍後再試。');
  });

  it('開發用表單：送出 email 後導向 /projects', async () => {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...original, assign },
      configurable: true,
    });
    const devLogin = vi.fn().mockResolvedValue({ user: { id: 'u', email: 'a@b.co', name: 'a' } });
    setup({ devLogin });
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co');
    await userEvent.click(screen.getByRole('button', { name: '開發用登入' }));
    expect(devLogin).toHaveBeenCalledWith('a@b.co');
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('/projects'));
  });

  it('開發用登入失敗時顯示對應訊息', async () => {
    setup({ devLogin: vi.fn().mockRejectedValue({ code: 'RATE_LIMITED' }) });
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co');
    await userEvent.click(screen.getByRole('button', { name: '開發用登入' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('操作太頻繁');
  });
});
