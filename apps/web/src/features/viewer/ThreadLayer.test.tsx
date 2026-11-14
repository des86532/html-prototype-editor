import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DRAFT_ID, useUiStore } from '@/state/uiStore';
import { alice, makeAnchor, makeThread } from '@/test-utils/fixtures';
import type { ThreadActions } from '@/features/comments/types';
import { ThreadLayer, type ThreadLayerProps } from './ThreadLayer';

const noopActions: ThreadActions = {
  onReply: vi.fn(),
  onSetStatus: vi.fn(),
  onSetTags: vi.fn(),
  onEditComment: vi.fn(),
  onDeleteComment: vi.fn(),
  onCopyLink: vi.fn(),
};

function setup(over: Partial<ThreadLayerProps> = {}) {
  const created = makeThread(9, { id: 'new1', comments: [] });
  const createThread = vi.fn().mockResolvedValue(created);
  const props: ThreadLayerProps = {
    threads: [],
    actions: noopActions,
    createThread,
    actor: { me: alice, role: 'owner' },
    pagePaths: ['index.html'],
    currentPageId: 'index.html',
    scale: 1,
    frameViewport: { w: 1000, h: 800 },
    rects: {},
    results: {},
    boundary: null,
    onScrollTo: vi.fn(),
    ...over,
  };
  const utils = render(
    <div>
      <button type="button">outside</button>
      <ThreadLayer {...props} />
    </div>,
  );
  return { createThread, props, ...utils };
}

const draftAt = (x: number, y: number) => ({
  anchor: makeAnchor(),
  rect: { x: x - 20, y: y - 10, w: 40, h: 20 },
});

beforeEach(() => useUiStore.getState().reset());
afterEach(() => useUiStore.getState().reset());

describe('draft flow (Figma-style composer)', () => {
  it('shows a semi-transparent draft pin at the click point and focuses the inline composer', async () => {
    setup();
    act(() => useUiStore.getState().setDraft(draftAt(300, 200)));
    const pin = await screen.findByTestId('pin-draft');
    expect(Number(pin.dataset.x)).toBeCloseTo(300);
    expect(Number(pin.dataset.y)).toBeCloseTo(200);
    expect(pin.querySelector('button')!.className).toContain('opacity-50');
    expect(screen.getByRole('dialog', { name: '新增留言' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('textbox', { name: '新增留言' })).toHaveFocus());
  });

  it('Esc discards the draft without calling the API', async () => {
    const user = userEvent.setup();
    const { createThread } = setup();
    act(() => useUiStore.getState().setDraft(draftAt(300, 200)));
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    expect(useUiStore.getState().draft).toBeNull();
    expect(screen.queryByTestId('pin-draft')).toBeNull();
    expect(createThread).not.toHaveBeenCalled();
  });

  it('empty submit discards the draft without calling the API', async () => {
    const user = userEvent.setup();
    const { createThread } = setup();
    act(() => useUiStore.getState().setDraft(draftAt(300, 200)));
    await user.click(await screen.findByRole('button', { name: '送出' }));
    expect(useUiStore.getState().draft).toBeNull();
    expect(createThread).not.toHaveBeenCalled();
  });

  it('whitespace-only submit also discards', async () => {
    const user = userEvent.setup();
    const { createThread } = setup();
    act(() => useUiStore.getState().setDraft(draftAt(300, 200)));
    await user.type(await screen.findByRole('textbox', { name: '新增留言' }), '   ');
    await user.click(screen.getByRole('button', { name: '送出' }));
    expect(useUiStore.getState().draft).toBeNull();
    expect(createThread).not.toHaveBeenCalled();
  });

  it('clicking outside the card discards the draft without calling the API', async () => {
    const user = userEvent.setup();
    const { createThread } = setup();
    act(() => useUiStore.getState().setDraft(draftAt(300, 200)));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'outside' }));
    expect(useUiStore.getState().draft).toBeNull();
    expect(createThread).not.toHaveBeenCalled();
  });

  it('a second click replaces the previous draft (only one draft pin)', async () => {
    setup();
    act(() => useUiStore.getState().setDraft(draftAt(300, 200)));
    await screen.findByTestId('pin-draft');
    act(() => useUiStore.getState().setDraft(draftAt(500, 400)));
    const pins = await screen.findAllByTestId('pin-draft');
    expect(pins).toHaveLength(1);
    expect(Number(pins[0]!.dataset.x)).toBeCloseTo(500);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('submit posts exactly once, then the card stays open on the new thread', async () => {
    const user = userEvent.setup();
    const { createThread } = setup();
    const draft = draftAt(300, 200);
    act(() => useUiStore.getState().setDraft(draft));
    await user.type(await screen.findByRole('textbox', { name: '新增留言' }), 'hello **world**');
    await user.click(screen.getByRole('button', { name: '送出' }));
    await waitFor(() => expect(useUiStore.getState().openThreadId).toBe('new1'));
    expect(createThread).toHaveBeenCalledTimes(1);
    expect(createThread).toHaveBeenCalledWith(draft.anchor, 'hello **world**');
    expect(useUiStore.getState().draft).toBeNull();
  });

  it('keeps the text and shows the error when the API call fails', async () => {
    const user = userEvent.setup();
    const createThread = vi.fn().mockRejectedValue(new Error('伺服器發生錯誤，請稍後再試。'));
    setup({ createThread });
    act(() => useUiStore.getState().setDraft(draftAt(300, 200)));
    await user.type(await screen.findByRole('textbox', { name: '新增留言' }), 'keep me');
    await user.click(screen.getByRole('button', { name: '送出' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('伺服器發生錯誤');
    expect(screen.getByRole('textbox', { name: '新增留言' })).toHaveValue('keep me');
    expect(useUiStore.getState().draft).not.toBeNull();
  });

  it('renders nothing when comments are hidden (Shift+C)', async () => {
    setup();
    act(() => {
      useUiStore.getState().setDraft(draftAt(300, 200));
    });
    await screen.findByTestId('pin-draft');
    act(() => useUiStore.getState().setShowComments(false));
    expect(screen.queryByTestId('pin-overlay')).toBeNull();
    expect(useUiStore.getState().draft).toBeNull();
  });
});

describe('pins and cards', () => {
  const t1 = makeThread(1);
  const withThread = (over: Partial<ThreadLayerProps> = {}) =>
    setup({
      threads: [t1],
      rects: { t1: { x: 100, y: 100, w: 100, h: 40 } },
      results: { t1: { status: 'exact', confidence: 1 } },
      ...over,
    });

  it('overlay is pointer-events:none; pins stay clickable in interact mode, and click toggles one card', async () => {
    const user = userEvent.setup();
    withThread();
    expect(screen.getByTestId('pin-overlay').className).toContain('pointer-events-none');
    const pin = screen.getByRole('button', { name: /^評論 #1：/ });
    expect(pin).toHaveAttribute('aria-expanded', 'false');
    await user.click(pin);
    expect(useUiStore.getState().openThreadId).toBe('t1');
    expect(await screen.findByRole('dialog', { name: '評論 #1 討論串' })).toBeInTheDocument();
    expect(pin).toHaveAttribute('aria-expanded', 'true');
    await user.click(pin);
    expect(useUiStore.getState().openThreadId).toBeNull();
  });

  it('pin scrolled out of view: card hidden, edge arrow shown; clicking it scrolls and reopens', async () => {
    const user = userEvent.setup();
    const onScrollTo = vi.fn();
    const { rerender, props } = withThread({ onScrollTo });
    await user.click(screen.getByRole('button', { name: /^評論 #1：/ }));
    expect(await screen.findByRole('dialog')).toBeVisible();
    rerender(
      <div>
        <ThreadLayer {...props} rects={{ t1: { x: 100, y: 5000, w: 100, h: 40 } }} />
      </div>,
    );
    expect(screen.getByTestId('edge-t1')).toHaveAttribute('data-side', 'bottom');
    expect(screen.queryByRole('dialog')).toBeNull(); // hidden attribute removes it from the a11y tree
    expect(screen.getByTestId('thread-popover')).not.toBeVisible();
    act(() => useUiStore.getState().openThread(null));
    await user.click(screen.getByTestId('edge-t1'));
    expect(onScrollTo).toHaveBeenCalledWith('t1');
    expect(useUiStore.getState().openThreadId).toBe('t1');
  });

  it('showResolved gates resolved pins', () => {
    withThread({ threads: [makeThread(1, { status: 'resolved' })] });
    expect(screen.queryByRole('button', { name: /^評論 #1：/ })).toBeNull();
    act(() => useUiStore.getState().setShowResolved(true));
    expect(screen.getByRole('button', { name: /^評論 #1：/ })).toBeInTheDocument();
  });

  it('draft id constant is stable', () => {
    expect(DRAFT_ID).toBe('__draft__');
  });
});
