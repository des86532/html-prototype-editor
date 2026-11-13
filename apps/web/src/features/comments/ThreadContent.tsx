import { useEffect, useId, useRef, useState } from 'react';
import { COMMENT_LIMITS, type Comment, type Thread, type ThreadTag } from '@hpe/shared';
import { SafeMarkdown } from '@/lib/SafeMarkdown';
import { TAG_LABELS, formatRelativeTime } from '@/lib/format';
import { Composer } from './Composer';
import { canComment, canDeleteComment, canEditComment, type ThreadActor } from './permissions';
import type { ThreadActions } from './types';

const TAGS = Object.keys(TAG_LABELS) as ThreadTag[];

export interface ThreadContentProps {
  thread: Thread;
  actor: ThreadActor;
  actions: ThreadActions;
  /** 回覆輸入框是否自動取得焦點（卡片開啟時） */
  autoFocusReply?: boolean;
}

function CommentMenu({
  comment,
  thread,
  actor,
  actions,
  onEdit,
}: {
  comment: Comment;
  thread: Thread;
  actor: ThreadActor;
  actions: ThreadActions;
  onEdit: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const canEdit = canEditComment(actor, comment);
  const canDelete = canDeleteComment(actor, comment);

  useEffect(() => {
    if (open) root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    setConfirming(false);
    if (refocus) button.current?.focus();
  };

  const run = async (fn: () => Promise<void> | void) => {
    setError(null);
    try {
      await fn();
      close(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失敗');
    }
  };

  const items = (): HTMLElement[] =>
    Array.from(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  return (
    <div
      ref={root}
      className="relative"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) {
          setOpen(false);
          setConfirming(false);
        }
      }}
    >
      <button
        ref={button}
        type="button"
        aria-label="留言選項"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="rounded px-1 text-neutral-500 hover:bg-neutral-100"
      >
        …
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="留言選項"
          className="absolute right-0 z-10 mt-1 w-36 rounded-md border border-neutral-200 bg-white py-1 text-sm shadow-lg"
          onKeyDown={(e) => {
            const list = items();
            const i = list.indexOf(document.activeElement as HTMLElement);
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              close(true);
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              list[(i + 1) % list.length]?.focus();
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              list[(i - 1 + list.length) % list.length]?.focus();
            }
          }}
        >
          {confirming ? (
            <>
              <p className="px-3 py-1 text-xs text-neutral-600">確定要刪除這則留言？</p>
              <button
                type="button"
                role="menuitem"
                className="block w-full px-3 py-1 text-left text-red-600 hover:bg-neutral-100"
                onClick={() => void run(() => actions.onDeleteComment(thread, comment.id))}
              >
                確定刪除
              </button>
              <button
                type="button"
                role="menuitem"
                className="block w-full px-3 py-1 text-left hover:bg-neutral-100"
                onClick={() => setConfirming(false)}
              >
                取消
              </button>
            </>
          ) : (
            <>
              {canEdit && (
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full px-3 py-1 text-left hover:bg-neutral-100"
                  onClick={() => {
                    close(false);
                    onEdit();
                  }}
                >
                  編輯
                </button>
              )}
              {canDelete && (
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full px-3 py-1 text-left text-red-600 hover:bg-neutral-100"
                  onClick={() => setConfirming(true)}
                >
                  刪除
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                className="block w-full px-3 py-1 text-left hover:bg-neutral-100"
                onClick={() => void run(() => actions.onCopyLink(thread))}
              >
                複製連結
              </button>
            </>
          )}
          {error && (
            <p role="alert" className="px-3 py-1 text-xs text-red-600">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function CommentRow({
  comment,
  thread,
  actor,
  actions,
}: {
  comment: Comment;
  thread: Thread;
  actor: ThreadActor;
  actions: ThreadActions;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <li className="py-2" data-comment-id={comment.id}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 text-sm">
          <span className="font-medium">{comment.author.name}</span>
          <span className="ml-2 text-xs text-neutral-500">
            {formatRelativeTime(comment.createdAt)}
            {comment.editedAt ? '（已編輯）' : ''}
          </span>
        </div>
        <CommentMenu
          comment={comment}
          thread={thread}
          actor={actor}
          actions={actions}
          onEdit={() => setEditing(true)}
        />
      </div>
      {editing ? (
        <div className="mt-1">
          <Composer
            label="編輯留言"
            initialValue={comment.body}
            autoFocus
            submitLabel="儲存"
            onCancel={() => setEditing(false)}
            onEscape={() => setEditing(false)}
            onSubmit={async (body) => {
              await actions.onEditComment(thread, comment.id, body);
              setEditing(false);
            }}
            onEmptySubmit={() => setEditing(false)}
          />
        </div>
      ) : (
        <SafeMarkdown source={comment.body} className="mt-0.5 text-neutral-800" />
      )}
    </li>
  );
}

/**
 * 卡片（ThreadPopover）與留言面板共用的討論串內容。順序：完整討論串、回覆輸入框、Resolve 按鈕、標籤。
 * 作者名稱與留言內容都以文字節點／SafeMarkdown 渲染。
 */
export function ThreadContent({ thread, actor, actions, autoFocusReply }: ThreadContentProps) {
  const [error, setError] = useState<string | null>(null);
  const writable = canComment(actor);
  const resolved = thread.status === 'resolved';

  const guard = async (fn: () => Promise<void> | void) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失敗');
    }
  };

  const toggleTag = (tag: ThreadTag) => {
    const has = thread.tags.includes(tag);
    if (!has && thread.tags.length >= COMMENT_LIMITS.maxTagsPerThread) return;
    const next = has ? thread.tags.filter((t) => t !== tag) : [...thread.tags, tag];
    void guard(() => actions.onSetTags(thread, next));
  };

  return (
    <div className="flex flex-col gap-2 text-sm">
      <ul className="divide-y divide-neutral-100" aria-label="討論串">
        {thread.comments.map((c) => (
          <CommentRow key={c.id} comment={c} thread={thread} actor={actor} actions={actions} />
        ))}
      </ul>
      {writable ? (
        <Composer
          label="回覆"
          placeholder="回覆…"
          submitLabel="回覆"
          autoFocus={autoFocusReply}
          rows={2}
          onSubmit={(body) => actions.onReply(thread, body)}
        />
      ) : (
        <p className="text-xs text-neutral-500">
          {actor.role === 'viewer' ? '這個連結只能檢視，無法留言。' : '請先填寫名字才能留言。'}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-neutral-100 pt-2">
        <button
          type="button"
          disabled={!writable}
          onClick={() =>
            void guard(() => actions.onSetStatus(thread, resolved ? 'open' : 'resolved'))
          }
          className="rounded-md border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-50 disabled:opacity-50"
        >
          {resolved ? '重新開啟' : 'Resolve'}
        </button>
        <div role="group" aria-label="標籤" className="flex flex-wrap gap-1">
          {TAGS.map((tag) => {
            const on = thread.tags.includes(tag);
            if (!writable && !on) return null;
            return (
              <button
                key={tag}
                type="button"
                aria-pressed={on}
                disabled={!writable}
                onClick={() => toggleTag(tag)}
                className={`rounded-full border px-2 py-0.5 text-xs ${
                  on
                    ? 'border-blue-600 bg-blue-50 text-blue-700'
                    : 'border-neutral-300 text-neutral-600 hover:bg-neutral-50'
                }`}
              >
                {TAG_LABELS[tag]}
              </button>
            );
          })}
        </div>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
