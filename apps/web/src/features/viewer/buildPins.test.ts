import { describe, expect, it } from 'vitest';
import { DEFAULT_THREAD_FILTERS } from '@hpe/shared';
import { DRAFT_ID } from '@/state/uiStore';
import { alice, makeAnchor, makeThread } from '@/test-utils/fixtures';
import { buildPins, effectiveAnchorStatus, type BuildPinsInput } from './buildPins';

const base: BuildPinsInput = {
  threads: [],
  rects: {},
  results: {},
  pagePaths: ['index.html', 'about.html'],
  currentPageId: 'index.html',
  scale: 1,
  showResolved: false,
  filters: DEFAULT_THREAD_FILTERS,
  openThreadId: null,
  draft: null,
  me: alice,
};

const rect = { x: 0, y: 0, w: 10, h: 10 };
const exact = { status: 'exact' as const, confidence: 1 };

describe('buildPins', () => {
  it('hides resolved pins by default and shows them with showResolved', () => {
    const t = makeThread(1, { status: 'resolved' });
    const input = { ...base, threads: [t], rects: { t1: rect }, results: { t1: exact } };
    expect(buildPins(input)).toHaveLength(0);
    expect(buildPins({ ...input, showResolved: true })).toHaveLength(1);
    // 已開啟的卡片即使被 resolve 也保留
    expect(buildPins({ ...input, openThreadId: 't1' })).toHaveLength(1);
  });

  it('never draws hidden/orphaned threads, nor threads on other pages or without a rect', () => {
    const hidden = makeThread(1);
    const orphan = makeThread(2, { anchor: makeAnchor({ pageId: 'gone.html' }) });
    const other = makeThread(3, { anchor: makeAnchor({ pageId: 'about.html' }) });
    const norect = makeThread(4);
    const ok = makeThread(5);
    const pins = buildPins({
      ...base,
      threads: [hidden, orphan, other, norect, ok],
      rects: { t1: rect, t5: rect, t4: null },
      results: {
        t1: { status: 'hidden', confidence: 1 },
        t4: exact,
        t5: { status: 'fuzzy', confidence: 0.7 },
      },
    });
    expect(pins.map((p) => p.id)).toEqual(['t5']);
    expect(pins[0]!.anchorStatus).toBe('fuzzy');
  });

  it('applies the shared filters', () => {
    const a = makeThread(1, { tags: ['bug'] });
    const b = makeThread(2);
    const input = {
      ...base,
      threads: [a, b],
      rects: { t1: rect, t2: rect },
      results: { t1: exact, t2: exact },
    };
    expect(
      buildPins({ ...input, filters: { ...DEFAULT_THREAD_FILTERS, tag: 'bug' } }).map((p) => p.id),
    ).toEqual(['t1']);
    expect(
      buildPins({ ...input, filters: { ...DEFAULT_THREAD_FILTERS, width: 390 } }),
    ).toHaveLength(0);
  });

  it('adds a semi-transparent draft pin at the pick rect', () => {
    const anchor = makeAnchor();
    const pins = buildPins({
      ...base,
      draft: { anchor, rect: { x: 50, y: 60, w: 100, h: 20 } },
      scale: 0.5,
    });
    expect(pins).toHaveLength(1);
    expect(pins[0]).toMatchObject({
      id: DRAFT_ID,
      draft: true,
      point: { x: 50 * 0.5 + 25, y: 35 },
    });
  });

  it('effectiveAnchorStatus: missing page is orphaned, other pages are unknown', () => {
    const t = makeThread(1, { anchor: makeAnchor({ pageId: 'gone.html' }) });
    expect(effectiveAnchorStatus(t, {}, base.pagePaths, 'index.html')).toBe('orphaned');
    const o = makeThread(2, { anchor: makeAnchor({ pageId: 'about.html' }) });
    expect(effectiveAnchorStatus(o, {}, base.pagePaths, 'index.html')).toBeNull();
  });
});
