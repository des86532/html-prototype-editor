import { useId, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ShareLink } from '@hpe/shared';
import { api as defaultApi, type Api } from '@/lib/api';
import { messageForError } from '@/lib/errorMessages';
import { Modal } from '@/features/ui/Modal';

export interface ShareDialogProps {
  projectId: string;
  open: boolean;
  onClose: () => void;
  api?: Api;
}

const ROLE_LABEL = { commenter: '可留言', viewer: '僅檢視' } as const;

export function linkStatus(
  link: ShareLink,
  now: number = Date.now(),
): '有效' | '已撤銷' | '已過期' {
  if (link.revokedAt) return '已撤銷';
  if (link.expiresAt && Date.parse(link.expiresAt) <= now) return '已過期';
  return '有效';
}

const fmt = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso : new Date(t).toLocaleString('zh-TW');
};

function ShareBody({ projectId, api = defaultApi }: Pick<ShareDialogProps, 'projectId' | 'api'>) {
  const qc = useQueryClient();
  const [role, setRole] = useState<'commenter' | 'viewer'>('commenter');
  const [expiry, setExpiry] = useState('');
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const roleId = useId();
  const expiryId = useId();
  const urlId = useId();
  const key = ['shareLinks', projectId] as const;

  const links = useQuery({
    queryKey: key,
    queryFn: async () => (await api.listShareLinks(projectId)).links,
  });

  const create = useMutation({
    mutationFn: (body: { role: 'commenter' | 'viewer'; expiresAt?: string }) =>
      api.createShareLink(projectId, body),
    onSuccess: (res) => {
      setCreatedUrl(res.url);
      setCopied(false);
      setError(null);
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => setError(messageForError(e)),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeShareLink(id),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => setError(messageForError(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (create.isPending) return;
    let expiresAt: string | undefined;
    if (expiry) {
      const t = new Date(expiry);
      if (Number.isNaN(t.getTime())) return setError('到期時間格式不正確。');
      if (t.getTime() <= Date.now()) return setError('到期時間必須在未來。');
      expiresAt = t.toISOString();
    }
    create.mutate({ role, ...(expiresAt ? { expiresAt } : {}) });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(createdUrl ?? '');
      setCopied(true);
    } catch {
      urlRef.current?.select();
    }
  };

  return (
    <>
      <div className="space-y-6">
        <form onSubmit={submit} className="space-y-3">
          <div className="flex flex-wrap gap-4">
            <div>
              <label htmlFor={roleId} className="mb-1 block text-sm font-medium text-slate-700">
                角色
              </label>
              <select
                id={roleId}
                value={role}
                onChange={(e) => setRole(e.target.value as 'commenter' | 'viewer')}
                className="rounded border border-slate-300 px-2 py-1.5 text-sm"
              >
                <option value="commenter">{ROLE_LABEL.commenter}</option>
                <option value="viewer">{ROLE_LABEL.viewer}</option>
              </select>
            </div>
            <div>
              <label htmlFor={expiryId} className="mb-1 block text-sm font-medium text-slate-700">
                到期時間（選填）
              </label>
              <input
                id={expiryId}
                type="datetime-local"
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                className="rounded border border-slate-300 px-2 py-1.5 text-sm"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={create.isPending}
            className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            建立分享連結
          </button>
        </form>

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        {createdUrl && (
          <div className="space-y-2 rounded border border-amber-300 bg-amber-50 p-3">
            <label htmlFor={urlId} className="block text-sm font-medium text-slate-800">
              分享連結
            </label>
            <div className="flex gap-2">
              <input
                id={urlId}
                ref={urlRef}
                readOnly
                value={createdUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => void copy()}
                className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm"
              >
                {copied ? '已複製' : '複製'}
              </button>
            </div>
            <p className="text-xs text-amber-800">
              這個連結只會顯示一次，關閉後將無法再次查看，請立即複製。
            </p>
          </div>
        )}

        <section>
          <h3 className="mb-2 text-sm font-semibold text-slate-800">現有連結</h3>
          {links.isPending ? (
            <p className="text-sm text-slate-500">載入中…</p>
          ) : links.isError ? (
            <p role="alert" className="text-sm text-red-600">
              {messageForError(links.error)}
            </p>
          ) : links.data.length === 0 ? (
            <p className="text-sm text-slate-500">尚未建立任何分享連結。</p>
          ) : (
            <ul className="divide-y divide-slate-200 text-sm">
              {links.data.map((l) => {
                const status = linkStatus(l);
                return (
                  <li key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
                    <span className="font-medium">{ROLE_LABEL[l.role]}</span>
                    <span className="text-slate-600">建立：{fmt(l.createdAt)}</span>
                    <span className="text-slate-600">
                      到期：{l.expiresAt ? fmt(l.expiresAt) : '永不'}
                    </span>
                    <span className={status === '有效' ? 'text-green-700' : 'text-slate-500'}>
                      {status}
                    </span>
                    {status === '有效' && (
                      <button
                        type="button"
                        disabled={revoke.isPending}
                        onClick={() => revoke.mutate(l.id)}
                        className="ml-auto rounded border border-red-300 px-2 py-1 text-xs text-red-700"
                      >
                        撤銷
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

export function ShareDialog({ open, onClose, ...rest }: ShareDialogProps) {
  return (
    <Modal open={open} title="分享專案" onClose={onClose} widthClass="max-w-2xl">
      <ShareBody {...rest} />
    </Modal>
  );
}
