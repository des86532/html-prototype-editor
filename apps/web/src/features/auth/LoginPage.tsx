import { useId, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api as defaultApi, type Api } from '@/lib/api';
import { messageForError } from '@/lib/errorMessages';

export function LoginPage({ api = defaultApi }: { api?: Api }) {
  const [email, setEmail] = useState('');
  const emailId = useId();
  const mutation = useMutation({ mutationFn: (e: string) => api.magicLink(e) });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = email.trim();
    if (!value || mutation.isPending) return;
    mutation.mutate(value);
  };

  const devLink = mutation.data?.devLink;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold text-slate-900">登入</h1>
      <p className="text-sm text-slate-600">輸入 Email，我們會寄送一次性的登入連結給你。</p>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label htmlFor={emailId} className="mb-1 block text-sm font-medium text-slate-700">
            Email
          </label>
          <input
            id={emailId}
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={mutation.isPending}
          className="w-full rounded bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {mutation.isPending ? '傳送中…' : '寄送登入連結'}
        </button>
      </form>
      {mutation.isError && (
        <p role="alert" className="text-sm text-red-600">
          {messageForError(mutation.error)}
        </p>
      )}
      {mutation.isSuccess && (
        <div role="status" className="space-y-3 rounded border border-green-200 bg-green-50 p-3">
          <p className="text-sm font-medium text-green-800">已送出登入連結</p>
          {devLink && (
            <button
              type="button"
              onClick={() => window.location.assign(devLink)}
              className="w-full rounded bg-amber-500 px-4 py-3 text-sm font-semibold text-white"
            >
              開啟登入連結（開發模式）
            </button>
          )}
        </div>
      )}
    </main>
  );
}
