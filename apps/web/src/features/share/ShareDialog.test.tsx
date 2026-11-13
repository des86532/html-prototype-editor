import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShareLink } from '@hpe/shared';
import type { Api } from '@/lib/api';
import { ShareDialog } from './ShareDialog';

afterEach(cleanup);

const link = (over: Partial<ShareLink>): ShareLink => ({
  id: 'l1',
  projectId: 'p1',
  role: 'commenter',
  createdAt: '2026-01-01T00:00:00Z',
  ...over,
});

function setup(stub: Record<string, unknown>, open = true) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const ui = (o: boolean) => (
    <QueryClientProvider client={qc}>
      <ShareDialog projectId="p1" open={o} onClose={() => {}} api={stub as unknown as Api} />
    </QueryClientProvider>
  );
  const r = render(ui(open));
  return { rerender: (o: boolean) => r.rerender(ui(o)) };
}

describe('ShareDialog', () => {
  it('shows URL once after creation and clears on close', async () => {
    const listShareLinks = vi.fn().mockResolvedValue({ links: [] });
    const createShareLink = vi.fn().mockResolvedValue({
      link: link({}),
      token: 't',
      url: 'http://app/s/secret',
    });
    const { rerender } = setup({ listShareLinks, createShareLink });
    await userEvent.selectOptions(await screen.findByLabelText('角色'), 'viewer');
    await userEvent.click(screen.getByRole('button', { name: '建立分享連結' }));
    const input = await screen.findByLabelText('分享連結');
    expect(input).toHaveValue('http://app/s/secret');
    expect(input).toHaveAttribute('readonly');
    expect(createShareLink).toHaveBeenCalledWith('p1', { role: 'viewer' });
    expect(screen.getByText(/只會顯示一次/)).toBeInTheDocument();
    rerender(false);
    rerender(true);
    expect(screen.queryByDisplayValue('http://app/s/secret')).toBeNull();
  });

  it('sends ISO expiry', async () => {
    const createShareLink = vi.fn().mockResolvedValue({ link: link({}), token: 't', url: 'u' });
    setup({ listShareLinks: vi.fn().mockResolvedValue({ links: [] }), createShareLink });
    const future = new Date(Date.now() + 86_400_000 * 3);
    const pad = (n: number) => String(n).padStart(2, '0');
    const local = `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}T10:00`;
    const input = await screen.findByLabelText('到期時間（選填）');
    await userEvent.type(input, local);
    await userEvent.click(screen.getByRole('button', { name: '建立分享連結' }));
    await screen.findByLabelText('分享連結');
    expect(createShareLink.mock.calls[0]![1].expiresAt).toBe(new Date(local).toISOString());
  });

  it('lists links with status and revokes active ones', async () => {
    const listShareLinks = vi.fn().mockResolvedValue({
      links: [
        link({ id: 'a' }),
        link({ id: 'b', revokedAt: '2026-01-02T00:00:00Z' }),
        link({ id: 'c', expiresAt: '2020-01-01T00:00:00Z' }),
      ],
    });
    const revokeShareLink = vi.fn().mockResolvedValue(undefined);
    setup({ listShareLinks, revokeShareLink });
    expect(await screen.findByText('有效')).toBeInTheDocument();
    expect(screen.getByText('已撤銷')).toBeInTheDocument();
    expect(screen.getByText('已過期')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: '撤銷' });
    expect(buttons).toHaveLength(1);
    await userEvent.click(buttons[0]!);
    expect(revokeShareLink).toHaveBeenCalledWith('a');
  });
});
