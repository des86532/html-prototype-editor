import { useId, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { EXPORT_FORMATS, type ExportFormat, type ExportQuery, type ThreadTag } from '@hpe/shared';
import { api as defaultApi, type Api } from '@/lib/api';
import { messageForError } from '@/lib/errorMessages';
import { TAG_LABELS } from '@/lib/format';
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
  csv: 'CSV',
  html: '單檔互動 HTML',
  package: 'Review Package ZIP',
};
const FORMAT_EXT: Record<ExportFormat, string> = {
  json: 'json',
  markdown: 'md',
  csv: 'csv',
  html: 'html',
  package: 'zip',
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
  const [tag, setTag] = useState<'all' | ThreadTag>('all');
  const [error, setError] = useState<string | null>(null);
  const statusId = useId();
  const tagId = useId();

  const estimate = useQuery({
    queryKey: ['exportEstimate', versionId],
    queryFn: () => api.exportEstimate(versionId),
    enabled: open,
  });

  const download = useMutation({
    mutationFn: async () => {
      const query: ExportQuery = {
        ...(status !== 'all' ? { status } : {}),
        ...(tag !== 'all' ? { tag } : {}),
      };
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
          <legend className="text-sm font-medium text-slate-800">格式</legend>
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
            <label htmlFor={statusId} className="mb-1 block text-sm font-medium text-slate-700">
              狀態
            </label>
            <select
              id={statusId}
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
              className="rounded border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="all">全部</option>
              <option value="open">open</option>
              <option value="resolved">resolved</option>
            </select>
          </div>
          <div>
            <label htmlFor={tagId} className="mb-1 block text-sm font-medium text-slate-700">
              標籤
            </label>
            <select
              id={tagId}
              value={tag}
              onChange={(e) => setTag(e.target.value as typeof tag)}
              className="rounded border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="all">全部</option>
              {(Object.keys(TAG_LABELS) as ThreadTag[]).map((t) => (
                <option key={t} value={t}>
                  {TAG_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <section aria-label="預估大小" className="rounded bg-slate-50 p-3 text-sm">
          {estimate.isPending ? (
            <p className="text-slate-500">計算預估大小中…</p>
          ) : estimate.isError ? (
            <p role="alert" className="text-red-600">
              {messageForError(estimate.error)}
            </p>
          ) : (
            est && (
              <ul className="space-y-0.5">
                <li>討論串數量：{est.threadCount}</li>
                <li>單檔 HTML 預估：{formatBytes(est.htmlBytes)}</li>
                <li>Review Package 預估：{formatBytes(est.packageBytes)}</li>
              </ul>
            )
          )}
        </section>
        {est?.warnLargeHtml && (
          <p
            role="alert"
            className="rounded border border-amber-400 bg-amber-100 p-3 text-sm font-semibold text-amber-900"
          >
            單檔 HTML 預估超過 20 MB，開啟可能較慢
          </p>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-4 py-2 text-sm text-slate-600"
          >
            關閉
          </button>
          <button
            type="button"
            disabled={download.isPending}
            onClick={() => download.mutate()}
            className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {download.isPending ? '匯出中…' : '下載'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
