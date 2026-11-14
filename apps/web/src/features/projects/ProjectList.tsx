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
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">我的專案</h1>
      <form onSubmit={submit} className="card flex items-end gap-2 p-4">
        <div className="flex-1">
          <label htmlFor={nameId} className="field-label">
            新專案名稱
          </label>
          <input
            id={nameId}
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            className="input"
          />
        </div>
        <button
          type="submit"
          disabled={create.isPending || !name.trim()}
          className="btn btn-primary"
        >
          建立專案
        </button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {list.isPending ? (
        <p className="text-sm text-ink-3">載入中…</p>
      ) : list.isError ? (
        <p role="alert" className="text-sm text-danger">
          {messageForError(list.error)}
        </p>
      ) : list.data.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line-strong p-8 text-center text-sm text-ink-3">
          還沒有任何專案，先建立一個吧。
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.data.map((p) => (
            <li
              key={p.id}
              className="card flex flex-col gap-3 p-4 transition-colors hover:border-line-strong"
            >
              <button
                type="button"
                onClick={() => onOpenProject(p.id)}
                className="min-w-0 text-left"
              >
                <span className="block truncate font-semibold text-ink">{p.name}</span>
                <span className="block text-xs text-ink-3">
                  建立於 {formatRelativeTime(p.createdAt)}
                </span>
              </button>
              {confirmId === p.id ? (
                <span className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
                  <span>確定刪除「{p.name}」？</span>
                  <button
                    type="button"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(p.id)}
                    className="btn btn-danger-solid btn-sm"
                  >
                    確認刪除
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmId(null)}
                    className="btn btn-ghost btn-sm"
                  >
                    取消
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  aria-label={`刪除 ${p.name}`}
                  onClick={() => setConfirmId(p.id)}
                  className="btn btn-ghost btn-sm self-end text-danger"
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
