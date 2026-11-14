import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Api } from '@/lib/api';
import { LoginPage } from './LoginPage';

afterEach(cleanup);

function setup(magicLink: ReturnType<typeof vi.fn>) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const api = { magicLink } as unknown as Api;
  render(
    <QueryClientProvider client={qc}>
      <LoginPage api={api} />
    </QueryClientProvider>,
  );
}

describe('LoginPage', () => {
  const original = window.location;
  afterEach(() => {
    Object.defineProperty(window, 'location', { value: original, configurable: true });
  });

  it('shows dev link button that navigates', async () => {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...original, assign },
      configurable: true,
    });
    const magicLink = vi
      .fn()
      .mockResolvedValue({ ok: true, devLink: 'http://x/auth/callback?t=1' });
    setup(magicLink);
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co');
    await userEvent.click(screen.getByRole('button', { name: '寄送登入連結' }));
    expect(magicLink).toHaveBeenCalledWith('a@b.co');
    expect(await screen.findByText('已送出登入連結')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '開啟登入連結（開發模式）' }));
    expect(assign).toHaveBeenCalledWith('http://x/auth/callback?t=1');
  });

  it('no dev button without devLink; errors mapped', async () => {
    setup(vi.fn().mockResolvedValue({ ok: true }));
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co');
    await userEvent.click(screen.getByRole('button', { name: '寄送登入連結' }));
    expect(await screen.findByText('已送出登入連結')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /開發模式/ })).toBeNull();
  });

  it('maps errors', async () => {
    setup(vi.fn().mockRejectedValue({ code: 'RATE_LIMITED' }));
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co');
    await userEvent.click(screen.getByRole('button', { name: '寄送登入連結' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('操作太頻繁');
  });
});
