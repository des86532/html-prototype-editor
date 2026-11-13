import { useMemo } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Anchor, Author, Comment, Thread, ThreadStatus, ThreadTag } from '@hpe/shared';
import { api as defaultApi, type Api } from '@/lib/api';
import { messageForError } from '@/lib/errorMessages';
import type { ThreadActions } from './types';

export const threadsKey = (versionId: string) => ['threads', versionId] as const;

function upsert(list: Thread[], thread: Thread): Thread[] {
  const i = list.findIndex((t) => t.id === thread.id);
  if (i === -1) return [...list, thread];
  const next = list.slice();
  next[i] = thread;
  return next;
}

/** 把 ApiError 轉成「message 已可顯示」的 Error（元件只顯示 message）。 */
async function friendly<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw new Error(messageForError(e));
  }
}

export interface UseThreadsOptions {
  api?: Api;
  /** 目前身分（樂觀更新留言作者用） */
  me: Author | null;
  /** 產生「複製連結」的 URL */
  buildThreadUrl?: (thread: Thread) => string;
}

export interface ThreadsApi {
  threads: Thread[];
  isLoading: boolean;
  error: string | null;
  createThread: (anchor: Anchor, body: string, tags?: ThreadTag[]) => Promise<Thread>;
  actions: ThreadActions;
}

let tmpSeq = 0;

/**
 * threads 的 query 與 mutations。回覆／狀態／標籤／編輯／刪除都是樂觀更新，失敗時回復並丟出
 * message 已是繁體中文的 Error。
 */
export function useThreads(versionId: string | null, opts: UseThreadsOptions): ThreadsApi {
  const qc = useQueryClient();
  const api = opts.api ?? defaultApi;
  const me = opts.me;
  const buildUrl = opts.buildThreadUrl;

  const query = useQuery({
    queryKey: threadsKey(versionId ?? ''),
    queryFn: async () => (await api.listThreads(versionId!)).threads,
    enabled: versionId !== null,
  });

  const key = threadsKey(versionId ?? '');

  const api_ = useMemo(() => {
    const read = () => qc.getQueryData<Thread[]>(key) ?? [];
    const write = (fn: (l: Thread[]) => Thread[]) =>
      qc.setQueryData<Thread[]>(key, (old) => fn(old ?? []));

    /** 樂觀套用 mutate；失敗時回復到套用前的快照。 */
    async function optimistic<T>(
      mutate: (l: Thread[]) => Thread[],
      call: () => Promise<T>,
      commit: (result: T) => void,
    ): Promise<void> {
      await qc.cancelQueries({ queryKey: key });
      const snapshot = read();
      write(mutate);
      try {
        commit(await friendly(call));
      } catch (e) {
        qc.setQueryData(key, snapshot);
        throw e;
      }
    }

    const patchThread = (id: string, fn: (t: Thread) => Thread) => (l: Thread[]) =>
      l.map((t) => (t.id === id ? fn(t) : t));

    const createThread = async (anchor: Anchor, body: string, tags?: ThreadTag[]) => {
      const { thread } = await friendly(() =>
        api.createThread(versionId!, { anchor, body, ...(tags && tags.length ? { tags } : {}) }),
      );
      write((l) => upsert(l, thread));
      return thread;
    };

    const actions: ThreadActions = {
      onReply: (thread, body) => {
        if (!me) throw new Error('請先填寫名字才能留言。');
        const temp: Comment = {
          id: `tmp-${++tmpSeq}`,
          threadId: thread.id,
          author: me,
          body,
          createdAt: new Date().toISOString(),
        };
        return optimistic(
          patchThread(thread.id, (t) => ({ ...t, comments: [...t.comments, temp] })),
          () => api.createComment(thread.id, body),
          (r) => write((l) => upsert(l, r.thread)),
        );
      },
      onSetStatus: (thread, status: ThreadStatus) =>
        optimistic(
          patchThread(thread.id, (t) => ({ ...t, status })),
          () => api.updateThread(thread.id, { status }),
          (r) => write((l) => upsert(l, r.thread)),
        ),
      onSetTags: (thread, tags) =>
        optimistic(
          patchThread(thread.id, (t) => ({ ...t, tags })),
          () => api.updateThread(thread.id, { tags }),
          (r) => write((l) => upsert(l, r.thread)),
        ),
      onEditComment: (thread, commentId, body) =>
        optimistic(
          patchThread(thread.id, (t) => ({
            ...t,
            comments: t.comments.map((c) =>
              c.id === commentId ? { ...c, body, editedAt: new Date().toISOString() } : c,
            ),
          })),
          () => api.updateComment(commentId, body),
          (r) => write((l) => upsert(l, r.thread)),
        ),
      onDeleteComment: (thread, commentId) =>
        optimistic(
          (l) =>
            l.flatMap((t) => {
              if (t.id !== thread.id) return [t];
              const comments = t.comments.filter((c) => c.id !== commentId);
              return comments.length === 0 ? [] : [{ ...t, comments }];
            }),
          () => api.deleteComment(commentId),
          (r) =>
            write((l) => (r.thread ? upsert(l, r.thread) : l.filter((t) => t.id !== thread.id))),
        ),
      onCopyLink: async (thread) => {
        const url = buildUrl?.(thread);
        if (!url) return;
        try {
          await navigator.clipboard.writeText(url);
        } catch {
          throw new Error('無法複製連結，請手動複製網址。');
        }
      },
    };
    return { createThread, actions };
  }, [qc, api, versionId, me, buildUrl]);

  return {
    threads: query.data ?? EMPTY,
    isLoading: query.isLoading,
    error: query.error ? messageForError(query.error) : null,
    createThread: api_.createThread,
    actions: api_.actions,
  };
}

const EMPTY: Thread[] = [];

export type { QueryClient };
