import { useId, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api as defaultApi, type Api } from '@/lib/api';
import { apiBaseUrl, googleLoginUrl } from '@/lib/apiClient';
import { messageForError } from '@/lib/errorMessages';

const DEFAULT_LOGIN_ERROR = 'Google 登入失敗，請稍後再試。';
const LOGIN_ERRORS: Record<string, string> = {
  google_denied: '已取消 Google 登入。',
  google_state: '登入逾時或狀態不符，請重新登入。',
  google_failed: DEFAULT_LOGIN_ERROR,
  google_email_unverified: '這個 Google 帳號的 Email 尚未驗證。',
  google_conflict: '這個 Email 已綁定其他 Google 帳號。',
  google_not_configured: '伺服器尚未設定 Google 登入。',
};

/** 只在 vite dev 顯示：對應 API 的 DEV_LOGIN（POST /auth/dev-login）。 */
function DevLoginForm({ api }: { api: Api }) {
  const [email, setEmail] = useState('');
  const emailId = useId();
  const mutation = useMutation({
    mutationFn: (e: string) => api.devLogin(e),
    onSuccess: () => window.location.assign('/projects'),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = email.trim();
    if (!value || mutation.isPending) return;
    mutation.mutate(value);
  };

  return (
    <form onSubmit={submit} className="space-y-3 border-t border-slate-200 pt-4">
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
        className="w-full rounded bg-amber-500 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        開發用登入
      </button>
      {mutation.isError && (
        <p role="alert" className="text-sm text-red-600">
          {messageForError(mutation.error)}
        </p>
      )}
    </form>
  );
}

export function LoginPage({ api = defaultApi, error }: { api?: Api; error?: string }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold text-slate-900">登入</h1>
      <p className="text-sm text-slate-600">使用 Google 帳號登入以管理你的專案。</p>
      {/* 用 <a>：一般頂層導覽，不受 CSP connect-src 限制 */}
      <a
        href={googleLoginUrl()}
        className="block w-full rounded bg-indigo-600 px-3 py-2 text-center text-sm font-medium text-white"
      >
        使用 Google 登入
      </a>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {LOGIN_ERRORS[error] ?? DEFAULT_LOGIN_ERROR}
        </p>
      )}
      {import.meta.env.DEV && <DevLoginForm api={api} />}
      <footer className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
        <p className="font-medium text-slate-700">API 伺服器端點：</p>
        <p className="mt-1 break-all font-mono text-slate-600">{apiBaseUrl()}</p>
        <p className="mt-1 text-slate-400">若伺服器未啟動或無法連線，登入將回傳網路連線錯誤。</p>
      </footer>
    </main>
  );
}
