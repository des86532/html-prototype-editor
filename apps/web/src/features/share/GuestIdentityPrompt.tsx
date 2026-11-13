import { useId, useState, type FormEvent } from 'react';
import { COMMENT_LIMITS } from '@hpe/shared';

export interface GuestIdentityPromptProps {
  onSubmit: (name: string) => void;
  busy?: boolean;
  error?: string | null;
  initialName?: string;
}

export function GuestIdentityPrompt({
  onSubmit,
  busy = false,
  error = null,
  initialName = '',
}: GuestIdentityPromptProps) {
  const [name, setName] = useState(initialName);
  const [touched, setTouched] = useState(false);
  const inputId = useId();
  const titleId = useId();
  const trimmed = name.trim();
  const tooLong = Array.from(trimmed).length > COMMENT_LIMITS.maxGuestNameLength;
  const validation =
    trimmed.length === 0
      ? '請輸入名字'
      : tooLong
        ? `名字最多 ${COMMENT_LIMITS.maxGuestNameLength} 個字`
        : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (validation || busy) return;
    onSubmit(trimmed);
  };

  return (
    <div
      role="dialog"
      aria-labelledby={titleId}
      className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-5 shadow-lg"
    >
      <h2 id={titleId} className="mb-1 text-base font-semibold text-slate-900">
        留言前請先輸入名字
      </h2>
      <p className="mb-3 text-sm text-slate-600">其他人會在留言上看到這個名字。</p>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <div>
          <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-slate-700">
            你的名字
          </label>
          <input
            id={inputId}
            type="text"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            aria-invalid={touched && validation ? true : undefined}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        {touched && validation && (
          <p role="alert" className="text-sm text-red-600">
            {validation}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          開始留言
        </button>
      </form>
    </div>
  );
}
