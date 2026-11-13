import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api as defaultApi, type Api } from '@/lib/api';
import { messageForError } from '@/lib/errorMessages';

export interface ProjectSettingsProps {
  projectId: string;
  onDeleted: () => void;
  api?: Api;
}

export function ProjectSettings({ projectId, onDeleted, api = defaultApi }: ProjectSettingsProps) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.getProject(projectId),
  });

  const remove = useMutation({
    mutationFn: () => api.deleteProject(projectId),
    onSuccess: () => {
      qc.removeQueries({ queryKey: ['project', projectId] });
      void qc.invalidateQueries({ queryKey: ['projects'] });
      onDeleted();
    },
    onError: (e) => setError(messageForError(e)),
  });

  return (
    <section className="space-y-6">
      <div>
        <h2 className="mb-2 text-lg font-semibold text-slate-900">專案資訊</h2>
        {detail.isPending ? (
          <p className="text-sm text-slate-500">載入中…</p>
        ) : detail.isError ? (
          <p role="alert" className="text-sm text-red-600">
            {messageForError(detail.error)}
          </p>
        ) : (
          <dl className="grid grid-cols-[6rem_1fr] gap-1 text-sm">
            <dt className="text-slate-500">名稱</dt>
            <dd>{detail.data.project.name}</dd>
            <dt className="text-slate-500">建立時間</dt>
            <dd>{new Date(detail.data.project.createdAt).toLocaleString('zh-TW')}</dd>
            <dt className="text-slate-500">版本數</dt>
            <dd>{detail.data.versions.length}</dd>
          </dl>
        )}
      </div>

      <div className="space-y-2 rounded border border-red-300 p-4">
        <h2 className="text-lg font-semibold text-red-700">危險區域</h2>
        <p className="text-sm text-slate-600">刪除專案會一併刪除所有版本與留言，且無法復原。</p>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        {confirming ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
              className="rounded bg-red-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              確認刪除專案
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded px-3 py-1.5 text-sm text-slate-600"
            >
              取消
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded border border-red-400 px-3 py-1.5 text-sm text-red-700"
          >
            刪除專案
          </button>
        )}
      </div>
    </section>
  );
}
