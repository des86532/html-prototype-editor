import { useEffect, useRef, useState } from 'react';
import { COMMENT_LIMITS } from '@hpe/shared';

export interface ComposerProps {
  /** 送出非空內容；reject 時保留文字並顯示錯誤 */
  onSubmit: (body: string) => Promise<void> | void;
  /** 送出空內容（草稿卡片用：直接捨棄，不呼叫 API） */
  onEmptySubmit?: () => void;
  /** 提供時 `Esc` 由這裡處理並停止冒泡（編輯模式取消編輯） */
  onEscape?: () => void;
  label: string;
  placeholder?: string;
  submitLabel?: string;
  initialValue?: string;
  autoFocus?: boolean;
  maxLength?: number;
  rows?: number;
  /** 額外的取消按鈕（編輯模式） */
  onCancel?: () => void;
}

/** 單一 textarea 加「送出」。Ctrl/⌘+Enter 也可送出。 */
export function Composer({
  onSubmit,
  onEmptySubmit,
  onEscape,
  label,
  placeholder = '輸入留言…（支援 Markdown）',
  submitLabel = '送出',
  initialValue = '',
  autoFocus = false,
  maxLength = COMMENT_LIMITS.maxBodyLength,
  rows = 3,
  onCancel,
}: ComposerProps) {
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (autoFocus) ref.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  const submit = async () => {
    if (busy) return;
    const body = value.trim();
    if (!body) {
      onEmptySubmit?.();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(body);
      if (alive.current) setValue('');
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error && e.message ? e.message : '送出失敗，請再試一次。');
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <textarea
        ref={ref}
        aria-label={label}
        placeholder={placeholder}
        value={value}
        rows={rows}
        maxLength={maxLength}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          } else if (e.key === 'Escape' && onEscape) {
            e.preventDefault();
            e.stopPropagation();
            onEscape();
          }
        }}
        className="w-full resize-y rounded-md border border-neutral-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
      />
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1 text-sm text-neutral-600 hover:bg-neutral-100"
          >
            取消
          </button>
        )}
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? '送出中…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
