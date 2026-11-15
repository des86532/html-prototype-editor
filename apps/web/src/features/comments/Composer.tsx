import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { autoUpdate, flip, offset, shift, useFloating } from '@floating-ui/react';
import { COMMENT_LIMITS, initials } from '@hpe/shared';
import { peerColor } from '@/features/live/PresenceBar';
import { CommentAssistContext } from './CommentAssistContext';
import { COLOR_PRESETS, applyInsert, findTrigger, type Trigger } from './composerTrigger';

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

/**
 * 單一 textarea 加「送出」。Ctrl/⌘+Enter 也可送出。
 * 輸入 `#` 跳出色票、`@` 跳出可提及的人（只做顯示，不送通知）。
 */
export function Composer({
  onSubmit,
  onEmptySubmit,
  onEscape,
  label,
  placeholder = '輸入留言…（支援 Markdown，# 選顏色、@ 提及）',
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
  const { candidates } = useContext(CommentAssistContext);
  const [trigger, setTrigger] = useState<Trigger>(null);
  const [active, setActive] = useState(0);
  /** Esc 或剛插入過的觸發位置：同一個位置不再自動開啟面板 */
  const dismissedAt = useRef<number | null>(null);
  const panelId = useId();

  const mentionOptions = useMemo(() => {
    if (trigger?.kind !== 'mention') return [];
    const q = trigger.query.toLowerCase();
    return candidates.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 8);
  }, [trigger, candidates]);
  const optionCount =
    trigger === null ? 0 : trigger.kind === 'color' ? COLOR_PRESETS.length : mentionOptions.length;
  const panelOpen = optionCount > 0;
  const optionId = (i: number) => `${panelId}-opt-${i}`;

  const { refs, floatingStyles } = useFloating({
    open: panelOpen,
    placement: 'bottom-start',
    strategy: 'fixed',
    middleware: [offset(4), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const setTextarea = useCallback(
    (el: HTMLTextAreaElement | null) => {
      ref.current = el;
      refs.setReference(el);
    },
    [refs],
  );

  const setPanel = (el: HTMLDivElement | null) => refs.setFloating(el);

  const syncTrigger = (el: HTMLTextAreaElement) => {
    let next = findTrigger(el.value, el.selectionStart);
    if (next === null) dismissedAt.current = null;
    else if (next.start === dismissedAt.current) next = null;
    const same =
      trigger?.kind === next?.kind &&
      trigger?.start === next?.start &&
      trigger?.query === next?.query;
    if (same) return;
    setTrigger(next);
    setActive(0);
  };

  const insert = (text: string) => {
    const el = ref.current;
    if (!el || !trigger) return;
    const r = applyInsert(el.value, trigger, text);
    dismissedAt.current = trigger.start;
    setValue(r.value);
    setTrigger(null);
    requestAnimationFrame(() => {
      el.focus({ preventScroll: true });
      el.setSelectionRange(r.caret, r.caret);
    });
  };
  const insertOption = (i: number) => {
    if (trigger?.kind === 'color') insert(COLOR_PRESETS[i]!);
    else {
      const c = mentionOptions[i];
      if (c) insert(`@${c.name} `);
    }
  };

  const onPanelKey = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!panelOpen || !trigger || e.metaKey || e.ctrlKey || e.altKey) return false;
    const stop = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        stop();
        setActive((a) => (a + 1) % optionCount);
        return true;
      case 'ArrowUp':
      case 'ArrowLeft':
        stop();
        setActive((a) => (a - 1 + optionCount) % optionCount);
        return true;
      case 'Enter':
      case 'Tab':
        stop();
        insertOption(active);
        return true;
      case 'Escape':
        stop();
        dismissedAt.current = trigger.start;
        setTrigger(null);
        return true;
      default:
        return false;
    }
  };
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
        ref={setTextarea}
        aria-label={label}
        placeholder={placeholder}
        value={value}
        rows={rows}
        maxLength={maxLength}
        disabled={busy}
        aria-autocomplete="list"
        aria-controls={panelOpen ? panelId : undefined}
        aria-activedescendant={panelOpen ? optionId(active) : undefined}
        onChange={(e) => {
          setValue(e.target.value);
          syncTrigger(e.target);
        }}
        onSelect={(e) => syncTrigger(e.currentTarget)}
        onKeyUp={(e) => syncTrigger(e.currentTarget)}
        onBlur={() => {
          // 視窗失焦（例如開啟原生取色器）時保留面板
          if (document.hasFocus()) setTrigger(null);
        }}
        onKeyDown={(e) => {
          if (onPanelKey(e)) return;
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          } else if (e.key === 'Escape' && onEscape) {
            e.preventDefault();
            e.stopPropagation();
            onEscape();
          }
        }}
        className="input h-auto resize-y py-2"
      />
      {panelOpen && trigger && (
        <div
          ref={setPanel}
          id={panelId}
          role="listbox"
          aria-label={trigger.kind === 'color' ? '選擇顏色' : '提及成員'}
          style={floatingStyles}
          className={`card z-40 p-1 shadow-lg ${trigger.kind === 'color' ? 'flex items-center gap-1' : 'flex min-w-40 flex-col'}`}
        >
          {trigger.kind === 'color' ? (
            <>
              {COLOR_PRESETS.map((hex, i) => (
                <button
                  key={hex}
                  id={optionId(i)}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  aria-label={hex}
                  title={hex}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insert(hex)}
                  style={{ backgroundColor: hex }}
                  className={`size-6 rounded-full ring-1 ring-line ${i === active ? 'outline-2 outline-offset-1 outline-accent' : ''}`}
                />
              ))}
              <label className="btn btn-ghost btn-sm" onMouseDown={(e) => e.preventDefault()}>
                自訂…
                <input
                  type="color"
                  className="sr-only"
                  aria-label="自訂顏色"
                  onChange={(e) => insert(e.target.value.toLowerCase())}
                />
              </label>
            </>
          ) : (
            mentionOptions.map((c, i) => (
              <button
                key={c.id}
                id={optionId(i)}
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insert(`@${c.name} `)}
                className={`flex items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-paper ${i === active ? 'bg-paper' : ''}`}
              >
                <span
                  aria-hidden="true"
                  className="grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-white"
                  style={{ background: peerColor(c.id) }}
                >
                  {initials(c.name)}
                </span>
                <span className="truncate">{c.name}</span>
              </button>
            ))
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className="btn btn-ghost btn-sm">
            取消
          </button>
        )}
        <button type="submit" disabled={busy} className="btn btn-primary btn-sm">
          {busy ? '送出中…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
