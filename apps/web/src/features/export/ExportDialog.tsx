import { useId, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { EXPORT_FORMATS, type ExportFormat, type ExportQuery } from '@hpe/shared';
import { api as defaultApi, type Api } from '@/lib/api';
import { messageForError } from '@/lib/errorMessages';
import { Modal } from '@/features/ui/Modal';
import { saveBlob } from './download';

export interface ExportDialogProps {
  versionId: string;
  projectName?: string;
  open: boolean;
  onClose: () => void;
  api?: Api;
}

const FORMAT_LABEL: Record<ExportFormat, string> = {
  json: 'JSON',
  markdown: 'Markdown',
  html: '單檔互動 HTML',
};
const FORMAT_EXT: Record<ExportFormat, string> = {
  json: 'json',
  markdown: 'md',
  html: 'html',
};

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function ExportDialog({
  versionId,
  projectName,
  open,
  onClose,
  api = defaultApi,
}: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>('json');
  const [status, setStatus] = useState<'all' | 'open' | 'resolved'>('all');
  const [error, setError] = useState<string | null>(null);
  const statusId = useId();

  const estimate = useQuery({
    queryKey: ['exportEstimate', versionId],
    queryFn: () => api.exportEstimate(versionId),
    enabled: open,
  });

  const download = useMutation({
    mutationFn: async () => {
      const query: ExportQuery = status !== 'all' ? { status } : {};
      const res = await api.exportVersion(versionId, format, query);
      saveBlob(res.blob, res.filename ?? `export-${format}.${FORMAT_EXT[format]}`);
    },
    onSuccess: () => setError(null),
    onError: (e) => setError(messageForError(e)),
  });

  const est = estimate.data;

  return (
    <Modal open={open} title={projectName ? `匯出：${projectName}` : '匯出'} onClose={onClose}>
      <div className="space-y-4">
        <fieldset className="space-y-1">
          <legend className="field-label">格式</legend>
          {EXPORT_FORMATS.map((f) => (
            <label key={f} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="export-format"
                value={f}
                checked={format === f}
                onChange={() => setFormat(f)}
              />
              {FORMAT_LABEL[f]}
            </label>
          ))}
        </fieldset>

        <div className="flex flex-wrap gap-4">
          <div>
            <label htmlFor={statusId} className="field-label">
              狀態
            </label>
            <select
              id={statusId}
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
              className="input w-auto"
            >
              <option value="all">全部</option>
              <option value="open">open</option>
              <option value="resolved">resolved</option>
            </select>
          </div>
        </div>

        <section aria-label="預估大小" className="rounded-md bg-paper p-3 text-sm">
          {estimate.isPending ? (
            <p className="text-ink-3">計算預估大小中…</p>
          ) : estimate.isError ? (
            <p role="alert" className="text-danger">
              {messageForError(estimate.error)}
            </p>
          ) : (
            est && (
              <ul className="space-y-0.5">
                <li>標記數量：{est.threadCount}</li>
                <li>單檔 HTML 預估：{formatBytes(est.htmlBytes)}</li>
              </ul>
            )
          )}
        </section>
        {est?.warnLargeHtml && (
          <p
            role="alert"
            className="rounded-md border border-warn/30 bg-warn-soft p-3 text-sm font-semibold text-warn"
          >
            單檔 HTML 預估超過 20 MB，開啟可能較慢
          </p>
        )}

        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            關閉
          </button>
          <button
            type="button"
            disabled={download.isPending}
            onClick={() => download.mutate()}
            className="btn btn-primary"
          >
            {download.isPending ? '匯出中…' : '下載'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
