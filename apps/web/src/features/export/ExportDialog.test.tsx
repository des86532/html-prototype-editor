import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Api } from '@/lib/api';
import { ExportDialog } from './ExportDialog';
import * as download from './download';

afterEach(cleanup);

function setup(stub: Record<string, unknown>) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <ExportDialog versionId="v1" open onClose={() => {}} api={stub as unknown as Api} />
    </QueryClientProvider>,
  );
}

const estimate = {
  htmlBytes: 25 * 1024 * 1024,
  packageBytes: 2048,
  threadCount: 7,
  warnLargeHtml: true,
};

describe('ExportDialog', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('shows estimate and large-html warning', async () => {
    setup({ exportEstimate: vi.fn().mockResolvedValue(estimate) });
    expect(await screen.findByText(/討論串數量：7/)).toBeInTheDocument();
    expect(screen.getByText(/25\.0 MB/)).toBeInTheDocument();
    expect(screen.getByText(/2\.0 KB/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('單檔 HTML 預估超過 20 MB，開啟可能較慢');
  });

  it('no warning when small', async () => {
    setup({ exportEstimate: vi.fn().mockResolvedValue({ ...estimate, warnLargeHtml: false }) });
    await screen.findByText(/討論串數量/);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('downloads with filters and server filename', async () => {
    const save = vi.spyOn(download, 'saveBlob').mockImplementation(() => {});
    const blob = new Blob(['x']);
    const exportVersion = vi.fn().mockResolvedValue({ blob, filename: 'out.md' });
    setup({
      exportEstimate: vi.fn().mockResolvedValue({ ...estimate, warnLargeHtml: false }),
      exportVersion,
    });
    await userEvent.click(screen.getByRole('radio', { name: 'Markdown' }));
    await userEvent.selectOptions(screen.getByLabelText('狀態'), 'open');
    await userEvent.selectOptions(screen.getByLabelText('標籤'), 'bug');
    await userEvent.click(screen.getByRole('button', { name: '下載' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(blob, 'out.md'));
    expect(exportVersion).toHaveBeenCalledWith('v1', 'markdown', { status: 'open', tag: 'bug' });
  });

  it('falls back to default filename and maps errors', async () => {
    const save = vi.spyOn(download, 'saveBlob').mockImplementation(() => {});
    const exportVersion = vi
      .fn()
      .mockResolvedValueOnce({ blob: new Blob(['x']), filename: null })
      .mockRejectedValueOnce({ code: 'FORBIDDEN' });
    setup({
      exportEstimate: vi.fn().mockResolvedValue({ ...estimate, warnLargeHtml: false }),
      exportVersion,
    });
    await userEvent.click(screen.getByRole('radio', { name: 'Review Package ZIP' }));
    await userEvent.click(screen.getByRole('button', { name: '下載' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.any(Blob), 'export-package.zip'));
    expect(exportVersion).toHaveBeenCalledWith('v1', 'package', {});
    await userEvent.click(screen.getByRole('button', { name: '下載' }));
    expect(await screen.findByText(/沒有權限/)).toBeInTheDocument();
  });
});
