import { useId, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api as defaultApi, type Api } from '@/lib/api';
import { messageForError } from '@/lib/errorMessages';
import { formatRelativeTime } from '@/lib/format';

export interface ProjectListProps {
  onOpenProject: (projectId: string) => void;
  api?: Api;
}

export function ProjectList({ onOpenProject, api = defaultApi }: ProjectListProps) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nameId = useId();

  const list = useQuery({
    queryKey: ['projects'],
    queryFn: async () => (await api.listProjects()).projects,
  });

  const create = useMutation({
    mutationFn: (n: string) => api.createProject(n),
    onSuccess: ({ project }) => {
      setName('');
      setError(null);
      void qc.invalidateQueries({ queryKey: ['projects'] });
      onOpenProject(project.id);
    },
    onError: (e) => setError(messageForError(e)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onSuccess: () => {
      setConfirmId(null);
      setError(null);
      void qc.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (e) => setError(messageForError(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n || create.isPending) return;
    create.mutate(n);
  };

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">我的專案</h1>
      <form onSubmit={submit} className="flex items-end gap-2">
        <div className="flex-1">
          <label htmlFor={nameId} className="mb-1 block text-sm font-medium text-slate-700">
            新專案名稱
          </label>
          <input
            id={nameId}
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={create.isPending || !name.trim()}
          className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          建立專案
        </button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {list.isPending ? (
        <p className="text-sm text-slate-500">載入中…</p>
      ) : list.isError ? (
        <p role="alert" className="text-sm text-red-600">
          {messageForError(list.error)}
        </p>
      ) : list.data.length === 0 ? (
        <p className="text-sm text-slate-500">還沒有任何專案，先建立一個吧。</p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded border border-slate-200">
          {list.data.map((p) => (
            <li key={p.id} className="flex items-center gap-3 p-3">
              <button
                type="button"
                onClick={() => onOpenProject(p.id)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block truncate font-medium text-slate-900">{p.name}</span>
                <span className="block text-xs text-slate-500">
                  建立於 {formatRelativeTime(p.createdAt)}
                </span>
              </button>
              {confirmId === p.id ? (
                <span className="flex items-center gap-2 text-sm">
                  <span>確定刪除「{p.name}」？</span>
                  <button
                    type="button"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(p.id)}
                    className="rounded bg-red-600 px-2 py-1 text-xs text-white disabled:opacity-50"
                  >
                    確認刪除
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmId(null)}
                    className="rounded px-2 py-1 text-xs text-slate-600"
                  >
                    取消
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  aria-label={`刪除 ${p.name}`}
                  onClick={() => setConfirmId(p.id)}
                  className="rounded border border-red-300 px-2 py-1 text-xs text-red-700"
                >
                  刪除
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
