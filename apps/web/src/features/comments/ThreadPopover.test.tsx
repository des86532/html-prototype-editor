import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { alice, bob, makeComment, makeThread } from '@/test-utils/fixtures';
import { ThreadPopover } from './ThreadPopover';
import type { ThreadActions } from './types';
import type { ThreadActor } from './permissions';

function actions(): ThreadActions {
  return {
    onReply: vi.fn(),
    onSetStatus: vi.fn(),
    onMoveMarkup: vi.fn(),
    onDeleteThread: vi.fn(),
    onEditComment: vi.fn(),
    onDeleteComment: vi.fn(),
    onCopyLink: vi.fn(),
  };
}

function Harness({
  actor = { me: alice, role: 'owner' },
  a = actions(),
  onClose = vi.fn(),
  canDelete = false,
  onDeleteMarkup = vi.fn(),
  thread = makeThread(12, {
    comments: [
      makeComment('c1', 't12', alice, 'first **bold**'),
      makeComment('c2', 't12', bob, '<script>alert(1)</script> hi'),
    ],
  }),
}: {
  actor?: ThreadActor;
  a?: ThreadActions;
  onClose?: (r: string) => void;
  canDelete?: boolean;
  onDeleteMarkup?: () => void;
  thread?: ReturnType<typeof makeThread>;
}) {
  const [ref, setRef] = useState<HTMLButtonElement | null>(null);
  return (
    <div>
      <button ref={setRef} type="button">
        pin
      </button>
      <ThreadPopover
        thread={thread}
        referenceEl={ref}
        actor={actor}
        actions={a}
        canDelete={canDelete}
        onDeleteMarkup={onDeleteMarkup}
        onClose={onClose}
      />
    </div>
  );
}

describe('ThreadPopover', () => {
  it('is a labelled dialog with content in the specified order', async () => {
    render(<Harness />);
    const dialog = await screen.findByRole('dialog', { name: '標記 #12' });
    const text = dialog.textContent ?? '';
    // 完整討論串 → 回覆輸入框 → 解決
    expect(text.indexOf('first')).toBeLessThan(text.indexOf('標記為已解決'));
    expect(within(dialog).getByRole('textbox', { name: '回覆' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '標記為已解決' })).toBeInTheDocument();
    expect(within(dialog).getAllByRole('button', { name: '留言選項' })).toHaveLength(2);
  });

  it('renders comment bodies sanitised and author names as text', async () => {
    render(<Harness />);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.querySelector('script')).toBeNull();
    expect(dialog.querySelector('strong')?.textContent).toBe('bold');
    expect(dialog).toHaveTextContent('Alice Chen');
  });

  it('moves focus in on open (reply box)', async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByRole('textbox', { name: '回覆' })).toHaveFocus());
  });

  it('Esc closes and returns focus to the pin', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await waitFor(() => expect(screen.getByRole('textbox', { name: '回覆' })).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledWith('escape');
    expect(screen.getByRole('button', { name: 'pin' })).toHaveFocus();
  });

  it('Esc inside the … menu only closes the menu', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const [menuBtn] = await screen.findAllByRole('button', { name: '留言選項' });
    await user.click(menuBtn!);
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(menuBtn).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('the … menu offers 編輯／刪除／複製連結 only where permitted', async () => {
    const user = userEvent.setup();
    const a = actions();
    render(<Harness a={a} actor={{ me: bob, role: 'commenter' }} />);
    const [aliceMenu, bobMenu] = await screen.findAllByRole('button', { name: '留言選項' });
    await user.click(aliceMenu!); // Alice's comment: commenter Bob may only copy the link
    expect(screen.queryByRole('menuitem', { name: '編輯' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: '刪除' })).toBeNull();
    await user.click(screen.getByRole('menuitem', { name: '複製連結' }));
    expect(a.onCopyLink).toHaveBeenCalledTimes(1);
    await user.click(bobMenu!); // own comment
    expect(screen.getByRole('menuitem', { name: '編輯' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '刪除' })).toBeInTheDocument();
  });

  it('owner may delete anyone’s comment, with a confirmation step', async () => {
    const user = userEvent.setup();
    const a = actions();
    render(<Harness a={a} />);
    const menus = await screen.findAllByRole('button', { name: '留言選項' });
    await user.click(menus[1]!);
    await user.click(screen.getByRole('menuitem', { name: '刪除' }));
    expect(a.onDeleteComment).not.toHaveBeenCalled();
    await user.click(screen.getByRole('menuitem', { name: '確定刪除' }));
    expect(a.onDeleteComment).toHaveBeenCalledWith(expect.objectContaining({ id: 't12' }), 'c2');
  });

  it('reply and resolve call the actions', async () => {
    const user = userEvent.setup();
    const a = actions();
    render(<Harness a={a} />);
    await user.type(await screen.findByRole('textbox', { name: '回覆' }), 'thanks');
    await user.click(screen.getByRole('button', { name: '回覆' }));
    expect(a.onReply).toHaveBeenCalledWith(expect.objectContaining({ id: 't12' }), 'thanks');
    await user.click(screen.getByRole('button', { name: '標記為已解決' }));
    expect(a.onSetStatus).toHaveBeenCalledWith(expect.anything(), 'resolved');
  });

  it('viewer role: no reply box, no mutations', async () => {
    render(<Harness actor={{ me: null, role: 'viewer' }} />);
    await screen.findByRole('dialog');
    expect(screen.queryByRole('textbox', { name: '回覆' })).toBeNull();
    expect(screen.getByRole('button', { name: '標記為已解決' })).toBeDisabled();
  });

  it('is hidden (but mounted) while the markup is out of view', () => {
    function H() {
      return (
        <ThreadPopover
          thread={makeThread(1)}
          referenceEl={null}
          hidden
          actor={{ me: alice, role: 'owner' }}
          actions={actions()}
          canDelete={false}
          onDeleteMarkup={vi.fn()}
          onClose={vi.fn()}
        />
      );
    }
    render(<H />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('thread-popover')).toHaveAttribute('hidden');
  });

  it('editing a comment submits the new body; Esc cancels the edit only', async () => {
    const user = userEvent.setup();
    const a = actions();
    const onClose = vi.fn();
    render(<Harness a={a} onClose={onClose} />);
    const menus = await screen.findAllByRole('button', { name: '留言選項' });
    await user.click(menus[0]!);
    await user.click(screen.getByRole('menuitem', { name: '編輯' }));
    const box = await screen.findByRole('textbox', { name: '編輯留言' });
    await user.clear(box);
    await user.type(box, 'edited');
    await user.click(screen.getByRole('button', { name: '儲存' }));
    expect(a.onEditComment).toHaveBeenCalledWith(expect.anything(), 'c1', 'edited');
    await waitFor(() => expect(screen.queryByRole('textbox', { name: '編輯留言' })).toBeNull());
    await user.click((await screen.findAllByRole('button', { name: '留言選項' }))[0]!);
    await user.click(screen.getByRole('menuitem', { name: '編輯' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: '編輯留言' })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a markup without comments shows the 新增說明 composer', async () => {
    const user = userEvent.setup();
    const a = actions();
    render(<Harness a={a} thread={makeThread(1, { number: null, comments: [] })} />);
    const dialog = await screen.findByRole('dialog', { name: '標記' });
    const box = within(dialog).getByRole('textbox', { name: '新增說明' });
    await user.type(box, 'note');
    await user.click(within(dialog).getByRole('button', { name: '送出' }));
    expect(a.onReply).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }), 'note');
  });

  it('deleting a markup with comments needs two clicks; without comments one', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    const { unmount } = render(<Harness canDelete onDeleteMarkup={onDelete} />);
    await user.click(await screen.findByRole('button', { name: '刪除標記' }));
    expect(onDelete).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '確定刪除（含 2 則留言）' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    unmount();

    const onDelete2 = vi.fn();
    render(
      <Harness
        canDelete
        onDeleteMarkup={onDelete2}
        thread={makeThread(3, { number: null, comments: [] })}
      />,
    );
    await user.click(await screen.findByRole('button', { name: '刪除標記' }));
    expect(onDelete2).toHaveBeenCalledTimes(1);
  });

  it('no delete button without canDelete', async () => {
    render(<Harness />);
    await screen.findByRole('dialog');
    expect(screen.queryByRole('button', { name: '刪除標記' })).toBeNull();
  });
});
