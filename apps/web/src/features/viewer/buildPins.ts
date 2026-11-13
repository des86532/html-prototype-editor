import {
  matchesFilters,
  type Anchor,
  type AnchorStatus,
  type Author,
  type Rect,
  type Thread,
  type ThreadFilters,
} from '@hpe/shared';
import { DRAFT_ID, type Draft } from '@/state/uiStore';
import { computePinGeometry, type PinItem, type Point } from './pinLayout';

export interface AnchorResult {
  status: AnchorStatus;
  confidence: number;
}

/**
 * 某個 thread 目前的有效錨點狀態：頁面不存在 → orphaned；在目前頁面 → agent 的解析結果（尚未解析 = null）；
 * 其他頁面 → null（切過去才會解析）。
 */
export function effectiveAnchorStatus(
  thread: Thread,
  results: Readonly<Record<string, AnchorResult | undefined>>,
  pagePaths: readonly string[],
  currentPageId: string | null,
): AnchorStatus | null {
  if (!pagePaths.includes(thread.anchor.pageId)) return 'orphaned';
  if (thread.anchor.pageId !== currentPageId) return null;
  return results[thread.id]?.status ?? null;
}

const DRAWABLE: ReadonlySet<AnchorStatus> = new Set(['exact', 'fuzzy', 'fallback']);

export interface BuildPinsInput {
  threads: readonly Thread[];
  rects: Readonly<Record<string, Rect | null | undefined>>;
  results: Readonly<Record<string, AnchorResult | undefined>>;
  pagePaths: readonly string[];
  currentPageId: string | null;
  scale: number;
  frameOffset?: Point;
  showResolved: boolean;
  filters: ThreadFilters;
  /** 目前開啟的卡片：即使剛被 resolve 也保持顯示 */
  openThreadId: string | null;
  draft: Draft | null;
  me: Author | null;
}

function summaryOf(t: Thread): PinItem['summary'] {
  const first = t.comments[0];
  return {
    authorName: first?.author.name ?? t.createdBy.name,
    createdAt: first?.createdAt ?? t.createdAt,
    body: first?.body ?? '',
    replyCount: Math.max(0, t.comments.length - 1),
  };
}

export function buildPins(input: BuildPinsInput): PinItem[] {
  const off = input.frameOffset ?? { x: 0, y: 0 };
  const pins: PinItem[] = [];
  for (const t of input.threads) {
    if (t.anchor.pageId !== input.currentPageId) continue;
    const status = effectiveAnchorStatus(t, input.results, input.pagePaths, input.currentPageId);
    if (!status || !DRAWABLE.has(status)) continue;
    const isOpen = input.openThreadId === t.id;
    if (!isOpen) {
      if (t.status === 'resolved' && !input.showResolved) continue;
      if (!matchesFilters(t, input.filters)) continue;
    }
    const rect = input.rects[t.id] ?? null;
    const g = computePinGeometry(
      { id: t.id, kind: t.anchor.kind, elementOffset: t.anchor.selectors.elementOffset, rect },
      input.scale,
      off,
    );
    if (!g) continue;
    pins.push({
      id: t.id,
      number: t.number,
      author: t.createdBy,
      kind: t.anchor.kind,
      anchorStatus: status,
      draft: false,
      resolved: t.status === 'resolved',
      point: g.point,
      box: g.box,
      summary: summaryOf(t),
    });
  }
  pins.sort((a, b) => (a.number ?? 0) - (b.number ?? 0));

  if (input.draft) {
    const a: Anchor = input.draft.anchor;
    const rect = input.rects[DRAFT_ID] ?? input.draft.rect;
    const g = computePinGeometry(
      { id: DRAFT_ID, kind: a.kind, elementOffset: a.selectors.elementOffset, rect },
      input.scale,
      off,
    );
    if (g) {
      pins.push({
        id: DRAFT_ID,
        number: null,
        author: input.me ?? { kind: 'guest', guestId: DRAFT_ID, name: '?' },
        kind: a.kind,
        anchorStatus: 'exact',
        draft: true,
        resolved: false,
        point: g.point,
        box: g.box,
        summary: { authorName: input.me?.name ?? '', createdAt: '', body: '', replyCount: 0 },
      });
    }
  }
  return pins;
}
