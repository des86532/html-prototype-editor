import { describe, expect, it, vi } from 'vitest';
import { handleShortcut, type ShortcutContext } from './shortcuts';
import { canComment, canDeleteComment, canEditComment } from './permissions';
import { alice, bob, makeComment } from '@/test-utils/fixtures';

function ctx(over: Partial<ShortcutContext> = {}): ShortcutContext {
  return {
    canComment: true,
    navigableIds: ['a', 'b', 'c'],
    openId: null,
    hasDraft: false,
    toggleMode: vi.fn(),
    toggleShowComments: vi.fn(),
    escape: vi.fn(),
    openThread: vi.fn(),
    toggleResolveOpen: vi.fn(),
    ...over,
  };
}
const ev = (
  key: string,
  extra: Partial<KeyboardEvent> = {},
  target: EventTarget | null = document.body,
) =>
  ({
    key,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    target,
    ...extra,
  }) as KeyboardEvent;

describe('keyboard shortcuts', () => {
  it('C toggles comment mode; Shift+C toggles comment visibility', () => {
    const c = ctx();
    expect(handleShortcut(ev('c'), c)).toBe(true);
    expect(c.toggleMode).toHaveBeenCalledTimes(1);
    expect(handleShortcut(ev('C', { shiftKey: true }), c)).toBe(true);
    expect(c.toggleShowComments).toHaveBeenCalledTimes(1);
    expect(c.toggleMode).toHaveBeenCalledTimes(1);
  });

  it('C is ignored for viewers (role gating) but Shift+C still works', () => {
    const c = ctx({ canComment: false });
    expect(handleShortcut(ev('c'), c)).toBe(false);
    expect(c.toggleMode).not.toHaveBeenCalled();
    expect(handleShortcut(ev('C', { shiftKey: true }), c)).toBe(true);
  });

  it('ignores events from inputs, textareas, selects and contenteditable', () => {
    const c = ctx();
    for (const tag of ['input', 'textarea', 'select']) {
      expect(handleShortcut(ev('c', {}, document.createElement(tag)), c)).toBe(false);
    }
    const div = document.createElement('div');
    Object.defineProperty(div, 'isContentEditable', { value: true });
    expect(handleShortcut(ev('j', {}, div), c)).toBe(false);
    expect(c.toggleMode).not.toHaveBeenCalled();
    expect(c.openThread).not.toHaveBeenCalled();
  });

  it('ignores modified keys (Ctrl/⌘/Alt+C)', () => {
    const c = ctx();
    expect(handleShortcut(ev('c', { metaKey: true }), c)).toBe(false);
    expect(handleShortcut(ev('c', { ctrlKey: true }), c)).toBe(false);
    expect(handleShortcut(ev('c', { altKey: true }), c)).toBe(false);
  });

  it('Esc only acts when there is a draft or an open card', () => {
    expect(handleShortcut(ev('Escape'), ctx())).toBe(false);
    const c1 = ctx({ hasDraft: true });
    expect(handleShortcut(ev('Escape'), c1)).toBe(true);
    expect(c1.escape).toHaveBeenCalled();
    const c2 = ctx({ openId: 'a' });
    expect(handleShortcut(ev('Escape'), c2)).toBe(true);
  });

  it('J/K move to the next/previous thread and open it', () => {
    const c = ctx({ openId: 'b' });
    handleShortcut(ev('j'), c);
    expect(c.openThread).toHaveBeenLastCalledWith('c');
    handleShortcut(ev('k'), c);
    expect(c.openThread).toHaveBeenLastCalledWith('a');
    const none = ctx();
    handleShortcut(ev('j'), none);
    expect(none.openThread).toHaveBeenLastCalledWith('a');
    handleShortcut(ev('k'), none);
    expect(none.openThread).toHaveBeenLastCalledWith('c');
    const end = ctx({ openId: 'c' });
    handleShortcut(ev('j'), end);
    expect(end.openThread).toHaveBeenLastCalledWith('c');
    expect(handleShortcut(ev('j'), ctx({ navigableIds: [] }))).toBe(false);
  });

  it('R resolves the open thread, only with permission', () => {
    const c = ctx({ openId: 'a' });
    expect(handleShortcut(ev('r'), c)).toBe(true);
    expect(c.toggleResolveOpen).toHaveBeenCalled();
    expect(handleShortcut(ev('r'), ctx())).toBe(false);
    expect(handleShortcut(ev('r'), ctx({ openId: 'a', canComment: false }))).toBe(false);
  });
});

describe('role gating', () => {
  const own = makeComment('c1', 't', alice, 'x');
  const theirs = makeComment('c2', 't', bob, 'y');
  it('viewers and unnamed commenters cannot comment', () => {
    expect(canComment({ me: null, role: 'viewer' })).toBe(false);
    expect(canComment({ me: bob, role: 'viewer' })).toBe(false);
    expect(canComment({ me: null, role: 'commenter' })).toBe(false);
    expect(canComment({ me: bob, role: 'commenter' })).toBe(true);
    expect(canComment({ me: alice, role: 'owner' })).toBe(true);
  });
  it('commenters edit/delete only their own comments; owner deletes any but edits only own', () => {
    const commenter = { me: bob, role: 'commenter' } as const;
    expect(canEditComment(commenter, theirs)).toBe(true);
    expect(canEditComment(commenter, own)).toBe(false);
    expect(canDeleteComment(commenter, own)).toBe(false);
    const owner = { me: alice, role: 'owner' } as const;
    expect(canDeleteComment(owner, theirs)).toBe(true);
    expect(canEditComment(owner, theirs)).toBe(false);
    expect(canEditComment(owner, own)).toBe(true);
  });
});
