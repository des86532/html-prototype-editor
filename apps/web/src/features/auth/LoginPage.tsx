import { useId, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api as defaultApi, type Api } from '@/lib/api';
import { apiBaseUrl, googleLoginUrl } from '@/lib/apiClient';
import { messageForError } from '@/lib/errorMessages';
import { CropMarks } from '@/features/ui/CropMarks';

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
    <form onSubmit={submit} className="space-y-3 border-t border-line pt-4">
      <div>
        <label htmlFor={emailId} className="field-label">
          Email
        </label>
        <input
          id={emailId}
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="input"
        />
      </div>
      <button type="submit" disabled={mutation.isPending} className="btn btn-secondary w-full">
        開發用登入
      </button>
      {mutation.isError && (
        <p role="alert" className="text-sm text-danger">
          {messageForError(mutation.error)}
        </p>
      )}
    </form>
  );
}

export function LoginPage({ api = defaultApi, error }: { api?: Api; error?: string }) {
  return (
    <main className="stage-grid flex min-h-dvh items-center justify-center p-6">
      <div className="card relative w-full max-w-sm space-y-4 p-8 shadow-sm">
        <CropMarks />
        <h1 className="text-2xl font-semibold tracking-tight text-ink">登入</h1>
        <p className="text-sm text-ink-2">使用 Google 帳號登入以管理你的專案。</p>
        {/* 用 <a>：一般頂層導覽，不受 CSP connect-src 限制 */}
        <a href={googleLoginUrl()} className="btn btn-primary btn-lg w-full">
          使用 Google 登入
        </a>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {LOGIN_ERRORS[error] ?? DEFAULT_LOGIN_ERROR}
          </p>
        )}
        {import.meta.env.DEV && <DevLoginForm api={api} />}
        <footer className="rounded-md border border-line bg-paper p-3 text-xs text-ink-3">
          <p className="font-medium text-ink-2">API 伺服器端點：</p>
          <p className="mt-1 break-all font-mono text-ink-2">{apiBaseUrl()}</p>
          <p className="mt-1">若伺服器未啟動或無法連線，登入將回傳網路連線錯誤。</p>
        </footer>
      </div>
    </main>
  );
}
