import { describe, expect, it, vi } from 'vitest';
import { handleShortcut, type ShortcutContext } from './shortcuts';
import { canComment, canDeleteComment, canEditComment, canManageMarkup } from './permissions';
import { alice, bob, makeComment, makeThread } from '@/test-utils/fixtures';

function ctx(over: Partial<ShortcutContext> = {}): ShortcutContext {
  return {
    canMarkup: true,
    mode: 'interact',
    navigableIds: ['a', 'b', 'c'],
    selectedId: null,
    toggleMode: vi.fn(),
    toggleShowMarkups: vi.fn(),
    escape: vi.fn(() => true),
    select: vi.fn(),
    setTool: vi.fn(),
    deleteSelected: vi.fn(),
    undo: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    zoomFit: vi.fn(),
    toggleFocusMode: vi.fn(),
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
  it('C toggles markup mode; Shift+C toggles markup visibility', () => {
    const c = ctx();
    expect(handleShortcut(ev('c'), c)).toBe(true);
    expect(c.toggleMode).toHaveBeenCalledTimes(1);
    expect(handleShortcut(ev('C', { shiftKey: true }), c)).toBe(true);
    expect(c.toggleShowMarkups).toHaveBeenCalledTimes(1);
    expect(c.toggleMode).toHaveBeenCalledTimes(1);
  });

  it('C is ignored without markup permission but Shift+C still works', () => {
    const c = ctx({ canMarkup: false });
    expect(handleShortcut(ev('c'), c)).toBe(false);
    expect(c.toggleMode).not.toHaveBeenCalled();
    expect(handleShortcut(ev('C', { shiftKey: true }), c)).toBe(true);
  });

  it('zoom keys and F (focus mode) work in any mode and are ignored in inputs', () => {
    const c = ctx({ canMarkup: false });
    for (const key of ['=', '+']) expect(handleShortcut(ev(key), c)).toBe(true);
    expect(c.zoomIn).toHaveBeenCalledTimes(2);
    expect(handleShortcut(ev('-'), c)).toBe(true);
    expect(c.zoomOut).toHaveBeenCalledTimes(1);
    expect(handleShortcut(ev('0'), c)).toBe(true);
    expect(c.zoomFit).toHaveBeenCalledTimes(1);
    expect(handleShortcut(ev('f'), c)).toBe(true);
    expect(c.toggleFocusMode).toHaveBeenCalledTimes(1);
    const textarea = document.createElement('textarea');
    for (const key of ['=', '-', '0', 'f'])
      expect(handleShortcut(ev(key, {}, textarea), c)).toBe(false);
    expect(handleShortcut(ev('-', { metaKey: true }), c)).toBe(false);
  });

  it('ignores events from inputs, textareas, selects and contenteditable', () => {
    const c = ctx({ mode: 'markup', selectedId: 'a' });
    for (const tag of ['input', 'textarea', 'select']) {
      expect(handleShortcut(ev('c', {}, document.createElement(tag)), c)).toBe(false);
      expect(handleShortcut(ev('Delete', {}, document.createElement(tag)), c)).toBe(false);
      expect(handleShortcut(ev('z', { metaKey: true }, document.createElement(tag)), c)).toBe(
        false,
      );
    }
    const div = document.createElement('div');
    Object.defineProperty(div, 'isContentEditable', { value: true });
    expect(handleShortcut(ev('j', {}, div), c)).toBe(false);
    expect(c.toggleMode).not.toHaveBeenCalled();
    expect(c.select).not.toHaveBeenCalled();
    expect(c.undo).not.toHaveBeenCalled();
  });

  it('ignores modified keys except ⌘/Ctrl+Z', () => {
    const c = ctx();
    expect(handleShortcut(ev('c', { metaKey: true }), c)).toBe(false);
    expect(handleShortcut(ev('c', { ctrlKey: true }), c)).toBe(false);
    expect(handleShortcut(ev('c', { altKey: true }), c)).toBe(false);
    expect(handleShortcut(ev('z', { metaKey: true, shiftKey: true }), c)).toBe(false);
    expect(handleShortcut(ev('z', { metaKey: true, altKey: true }), c)).toBe(false);
    expect(c.undo).not.toHaveBeenCalled();
  });

  it('⌘Z / Ctrl+Z calls undo when markup is allowed', () => {
    const c = ctx();
    expect(handleShortcut(ev('z', { metaKey: true }), c)).toBe(true);
    expect(handleShortcut(ev('z', { ctrlKey: true }), c)).toBe(true);
    expect(c.undo).toHaveBeenCalledTimes(2);
    const no = ctx({ canMarkup: false });
    expect(handleShortcut(ev('z', { metaKey: true }), no)).toBe(false);
    expect(no.undo).not.toHaveBeenCalled();
  });

  it('Esc returns whatever escape() returns', () => {
    const c1 = ctx({ escape: vi.fn(() => false) });
    expect(handleShortcut(ev('Escape'), c1)).toBe(false);
    expect(c1.escape).toHaveBeenCalled();
    expect(handleShortcut(ev('Escape'), ctx())).toBe(true);
  });

  it('J/K move to the next/previous marker and select it', () => {
    const c = ctx({ selectedId: 'b' });
    handleShortcut(ev('j'), c);
    expect(c.select).toHaveBeenLastCalledWith('c');
    handleShortcut(ev('k'), c);
    expect(c.select).toHaveBeenLastCalledWith('a');
    const none = ctx();
    handleShortcut(ev('j'), none);
    expect(none.select).toHaveBeenLastCalledWith('a');
    handleShortcut(ev('k'), none);
    expect(none.select).toHaveBeenLastCalledWith('c');
    const end = ctx({ selectedId: 'c' });
    handleShortcut(ev('j'), end);
    expect(end.select).toHaveBeenLastCalledWith('c');
    expect(handleShortcut(ev('j'), ctx({ navigableIds: [] }))).toBe(false);
  });

  it('tool keys only act in markup mode', () => {
    const m = ctx({ mode: 'markup' });
    const expected = {
      v: 'select',
      r: 'rect',
      a: 'arrow',
      p: 'pen',
      h: 'highlighter',
      t: 'text',
    };
    for (const [k, tool] of Object.entries(expected)) {
      expect(handleShortcut(ev(k), m)).toBe(true);
      expect(m.setTool).toHaveBeenLastCalledWith(tool);
    }
    const i = ctx({ mode: 'interact' });
    expect(handleShortcut(ev('r'), i)).toBe(false);
    expect(i.setTool).not.toHaveBeenCalled();
  });

  it('Delete/Backspace delete the selection only when something is selected', () => {
    expect(handleShortcut(ev('Delete'), ctx())).toBe(false);
    const c = ctx({ selectedId: 'a' });
    expect(handleShortcut(ev('Delete'), c)).toBe(true);
    expect(handleShortcut(ev('Backspace'), c)).toBe(true);
    expect(c.deleteSelected).toHaveBeenCalledTimes(2);
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
  it('markup management: owner any, commenter only own', () => {
    const mine = makeThread(1, { createdBy: bob });
    const others = makeThread(2, { createdBy: alice });
    expect(canManageMarkup({ me: alice, role: 'owner' }, mine)).toBe(true);
    expect(canManageMarkup({ me: bob, role: 'commenter' }, mine)).toBe(true);
    expect(canManageMarkup({ me: bob, role: 'commenter' }, others)).toBe(false);
    expect(canManageMarkup({ me: null, role: 'viewer' }, mine)).toBe(false);
  });
});
