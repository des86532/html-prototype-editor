import { beforeEach, describe, expect, it } from 'vitest';
import { makeAnchor } from '@/test-utils/fixtures';
import { useUiStore } from './uiStore';

const draft = (x: number) => ({ anchor: makeAnchor(), rect: { x, y: 0, w: 1, h: 1 } });
const s = () => useUiStore.getState();

beforeEach(() => s().reset());

describe('uiStore', () => {
  it('defaults: interact mode, comments shown, resolved hidden, panel collapsed', () => {
    expect(s()).toMatchObject({
      mode: 'interact',
      showComments: true,
      showResolved: false,
      panelOpen: false,
      openThreadId: null,
      draft: null,
    });
  });

  it('at most one card: a draft closes the open card and opening a card drops the draft', () => {
    s().openThread('a');
    s().setDraft(draft(1));
    expect(s().openThreadId).toBeNull();
    s().openThread('b');
    expect(s().draft).toBeNull();
    expect(s().openThreadId).toBe('b');
  });

  it('a new draft replaces the old one', () => {
    s().setDraft(draft(1));
    s().setDraft(draft(2));
    expect(s().draft?.rect.x).toBe(2);
  });

  it('leaving comment mode or hiding comments discards drafts and closes cards', () => {
    s().setMode('comment');
    s().setDraft(draft(1));
    s().setMode('interact');
    expect(s().draft).toBeNull();
    s().openThread('a');
    s().toggleShowComments();
    expect(s()).toMatchObject({ showComments: false, openThreadId: null });
    s().toggleShowComments();
    expect(s().showComments).toBe(true);
  });

  it('filters patch merges', () => {
    s().setFilters({ tag: 'bug' });
    s().setFilters({ status: 'open' });
    expect(s().filters).toMatchObject({ tag: 'bug', status: 'open', pageId: null });
  });
});
