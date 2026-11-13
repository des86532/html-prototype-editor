import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Api } from '@/lib/api';
import { CdnAllowlistPicker } from './CdnAllowlistPicker';

afterEach(cleanup);

function setup(updateVersion: ReturnType<typeof vi.fn>, value: string[], onChange = vi.fn()) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <CdnAllowlistPicker
        versionId="v1"
        value={value}
        api={{ updateVersion } as unknown as Api}
        onChange={onChange}
      />
    </QueryClientProvider>,
  );
  return onChange;
}

describe('CdnAllowlistPicker', () => {
  it('sends union of checked preset origins', async () => {
    const update = vi.fn().mockResolvedValue({});
    const onChange = setup(update, ['https://cdn.jsdelivr.net']);
    expect(screen.getByRole('checkbox', { name: /jsDelivr/ })).toBeChecked();
    await userEvent.click(screen.getByRole('checkbox', { name: /Google Fonts/ }));
    expect(update).toHaveBeenCalledWith('v1', {
      cdnAllowlist: [
        'https://fonts.googleapis.com',
        'https://fonts.gstatic.com',
        'https://cdn.jsdelivr.net',
      ],
    });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  it('partial preset is unchecked; untoggle removes origins', async () => {
    const update = vi.fn().mockResolvedValue({});
    setup(update, ['https://fonts.googleapis.com', 'https://unpkg.com']);
    expect(screen.getByRole('checkbox', { name: /Google Fonts/ })).not.toBeChecked();
    await userEvent.click(screen.getByRole('checkbox', { name: /unpkg/ }));
    expect(update).toHaveBeenCalledWith('v1', { cdnAllowlist: [] });
  });

  it('rolls back and shows message on failure', async () => {
    const update = vi.fn().mockRejectedValue({ code: 'FORBIDDEN' });
    setup(update, []);
    const box = screen.getByRole('checkbox', { name: /unpkg/ });
    await userEvent.click(box);
    expect(await screen.findByRole('alert')).toHaveTextContent('沒有權限');
    expect(box).not.toBeChecked();
  });
});
