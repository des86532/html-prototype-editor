import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UPLOAD_LIMITS } from '@hpe/shared';
import type { Api } from '@/lib/api';
import { ImportDialog } from './ImportDialog';
import { makeVersion } from './fixtures';

afterEach(cleanup);

function setup(stub: Record<string, unknown>) {
  const onImported = vi.fn();
  const onClose = vi.fn();
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <ImportDialog
        projectId="p1"
        open
        onClose={onClose}
        onImported={onImported}
        api={stub as unknown as Api}
      />
    </QueryClientProvider>,
  );
  return { onImported, onClose };
}

const html = () => new File(['<p>x</p>'], 'a.html', { type: 'text/html' });

describe('ImportDialog', () => {
  it('rejects bad extension without calling API', async () => {
    const createVersionFromFile = vi.fn();
    setup({ createVersionFromFile });
    await userEvent.upload(
      screen.getByLabelText('選擇檔案', { selector: 'input' }),
      new File(['x'], 'a.exe'),
      { applyAccept: false },
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('僅支援');
    await userEvent.click(screen.getByRole('button', { name: '匯入' }));
    expect(createVersionFromFile).not.toHaveBeenCalled();
  });

  it('rejects oversized files without calling API', async () => {
    const createVersionFromFile = vi.fn();
    setup({ createVersionFromFile });
    const big = new File(['x'], 'a.zip');
    Object.defineProperty(big, 'size', { value: UPLOAD_LIMITS.maxArchiveBytes + 1 });
    await userEvent.upload(screen.getByLabelText('選擇檔案', { selector: 'input' }), big);
    expect(await screen.findByRole('alert')).toHaveTextContent('壓縮檔超過');
    expect(createVersionFromFile).not.toHaveBeenCalled();
  });

  it('maps IMPORT_* errors', async () => {
    const createVersionFromFile = vi.fn().mockRejectedValue({ code: 'IMPORT_PATH_TRAVERSAL' });
    setup({ createVersionFromFile });
    await userEvent.upload(screen.getByLabelText('選擇檔案', { selector: 'input' }), html());
    await userEvent.click(screen.getByRole('button', { name: '匯入' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('跳出目錄');
  });

  it('uploads and shows report, done calls onImported', async () => {
    const v = makeVersion();
    const createVersionFromFile = vi.fn().mockResolvedValue({ version: v });
    const { onImported } = setup({ createVersionFromFile });
    await userEvent.upload(screen.getByLabelText('選擇檔案', { selector: 'input' }), html());
    await userEvent.click(screen.getByRole('button', { name: '匯入' }));
    expect(await screen.findByText('安全性報告')).toBeInTheDocument();
    expect(createVersionFromFile).toHaveBeenCalledWith('p1', expect.any(File), undefined);
    await userEvent.click(screen.getByRole('button', { name: '完成' }));
    expect(onImported).toHaveBeenCalledWith(v);
  });

  it('entry chooser flow via version candidates', async () => {
    const pending = makeVersion({
      entryPage: '',
      status: 'processing',
      entryCandidates: ['a.html', 'b.html'],
    });
    const final = makeVersion({ entryPage: 'b.html' });
    const createVersionFromFile = vi.fn().mockResolvedValue({ version: pending });
    const updateVersion = vi.fn().mockResolvedValue({ version: final });
    const { onImported } = setup({ createVersionFromFile, updateVersion });
    await userEvent.upload(screen.getByLabelText('選擇檔案', { selector: 'input' }), html());
    await userEvent.click(screen.getByRole('button', { name: '匯入' }));
    await userEvent.click(await screen.findByRole('radio', { name: 'b.html' }));
    await userEvent.click(screen.getByRole('button', { name: '確認入口' }));
    expect(updateVersion).toHaveBeenCalledWith('v1', { entryPage: 'b.html' });
    await userEvent.click(await screen.findByRole('button', { name: '完成' }));
    expect(onImported).toHaveBeenCalledWith(final);
  });

  it('IMPORT_ENTRY_REQUIRED error resubmits with chosen entry', async () => {
    const createVersionFromFile = vi
      .fn()
      .mockRejectedValueOnce({
        code: 'IMPORT_ENTRY_REQUIRED',
        details: { candidates: ['x.html', 'y.html'] },
      })
      .mockResolvedValueOnce({ version: makeVersion({ entryPage: 'y.html' }) });
    setup({ createVersionFromFile });
    await userEvent.upload(screen.getByLabelText('選擇檔案', { selector: 'input' }), html());
    await userEvent.click(screen.getByRole('button', { name: '匯入' }));
    await userEvent.click(await screen.findByRole('radio', { name: 'y.html' }));
    await userEvent.click(screen.getByRole('button', { name: '確認入口' }));
    expect(await screen.findByRole('button', { name: '完成' })).toBeInTheDocument();
    expect(createVersionFromFile).toHaveBeenLastCalledWith('p1', expect.any(File), 'y.html');
  });

  it('paste flow', async () => {
    const createVersionFromSource = vi.fn().mockResolvedValue({ version: makeVersion() });
    setup({ createVersionFromSource });
    await userEvent.click(screen.getByRole('tab', { name: '貼上原始碼' }));
    await userEvent.click(screen.getByRole('button', { name: '匯入' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(createVersionFromSource).not.toHaveBeenCalled();
    await userEvent.click(screen.getByLabelText('HTML 原始碼'));
    await userEvent.paste('<h1>hi</h1>');
    await userEvent.click(screen.getByRole('button', { name: '匯入' }));
    expect(await screen.findByText('安全性報告')).toBeInTheDocument();
    expect(createVersionFromSource).toHaveBeenCalledWith('p1', { html: '<h1>hi</h1>' });
  });
});
