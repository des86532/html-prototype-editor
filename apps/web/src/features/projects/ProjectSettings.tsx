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
        <h2 className="mb-2 text-lg font-semibold text-ink">專案資訊</h2>
        {detail.isPending ? (
          <p className="text-sm text-ink-3">載入中…</p>
        ) : detail.isError ? (
          <p role="alert" className="text-sm text-danger">
            {messageForError(detail.error)}
          </p>
        ) : (
          <dl className="grid grid-cols-[6rem_1fr] gap-1 text-sm text-ink">
            <dt className="text-ink-3">名稱</dt>
            <dd>{detail.data.project.name}</dd>
            <dt className="text-ink-3">建立時間</dt>
            <dd className="font-mono">
              {new Date(detail.data.project.createdAt).toLocaleString('zh-TW')}
            </dd>
            <dt className="text-ink-3">版本數</dt>
            <dd className="font-mono">{detail.data.versions.length}</dd>
          </dl>
        )}
      </div>

      <div className="space-y-2 rounded-md border border-danger/40 p-4">
        <h2 className="text-lg font-semibold text-danger">危險區域</h2>
        <p className="text-sm text-ink-2">刪除專案會一併刪除所有版本與留言，且無法復原。</p>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        {confirming ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
              className="btn btn-danger-solid"
            >
              確認刪除專案
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="btn btn-ghost">
              取消
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className="btn btn-danger">
            刪除專案
          </button>
        )}
      </div>
    </section>
  );
}
