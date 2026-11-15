import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { Thread } from '@hpe/shared';
import { makeThread } from '@/test-utils/fixtures';
import { applyLiveDelete, applyLiveUpsert, threadsKey } from './useThreads';

const body = (t: Thread | undefined) => t?.comments[0]?.body;

describe('applyLiveUpsert', () => {
  const key = threadsKey('v1');
  const withRev = (rev: number, text: string): Thread => {
    const t = makeThread(1, { rev });
    return { ...t, comments: [{ ...t.comments[0]!, body: text }] };
  };

  it('ignores older revs, replaces on equal or newer', () => {
    const qc = new QueryClient();
    qc.setQueryData<Thread[]>(key, [withRev(3, 'r3')]);
    applyLiveUpsert(qc, 'v1', withRev(2, 'r2'));
    expect(body(qc.getQueryData<Thread[]>(key)?.[0])).toBe('r3');
    applyLiveUpsert(qc, 'v1', withRev(3, 'r3b'));
    expect(body(qc.getQueryData<Thread[]>(key)?.[0])).toBe('r3b');
    applyLiveUpsert(qc, 'v1', withRev(4, 'r4'));
    expect(body(qc.getQueryData<Thread[]>(key)?.[0])).toBe('r4');
  });

  it('appends unknown threads and applyLiveDelete removes them', () => {
    const qc = new QueryClient();
    qc.setQueryData<Thread[]>(key, []);
    applyLiveUpsert(qc, 'v1', makeThread(2));
    expect(qc.getQueryData<Thread[]>(key)).toHaveLength(1);
    applyLiveDelete(qc, 'v1', 't2');
    expect(qc.getQueryData<Thread[]>(key)).toEqual([]);
  });
});
