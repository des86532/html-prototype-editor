import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_THREAD_FILTERS } from '@hpe/shared';
import { alice, bob, makeAnchor, makeThread } from '@/test-utils/fixtures';
import { CommentPanel, type CommentPanelProps } from './CommentPanel';
import { Filters } from './Filters';

const actions = {
  onReply: vi.fn(),
  onSetStatus: vi.fn(),
  onSetTags: vi.fn(),
  onEditComment: vi.fn(),
  onDeleteComment: vi.fn(),
  onCopyLink: vi.fn(),
};

function panel(over: Partial<CommentPanelProps> = {}) {
  const props: CommentPanelProps = {
    items: [
      { thread: makeThread(1), anchorStatus: 'exact' },
      {
        thread: makeThread(2, {
          anchor: makeAnchor({ stateHint: { hash: '#modal', inDialog: true } }),
        }),
        anchorStatus: 'hidden',
      },
      {
        thread: makeThread(3, { anchor: makeAnchor({ pageId: 'gone.html' }) }),
        anchorStatus: 'orphaned',
      },
      {
        thread: makeThread(4, { createdBy: bob, tags: ['bug'], status: 'resolved' }),
        anchorStatus: 'exact',
      },
    ],
    filters: DEFAULT_THREAD_FILTERS,
    onFiltersChange: vi.fn(),
    pages: ['index.html'],
    currentWidth: 1440,
    openId: null,
    onSelect: vi.fn(),
    actor: { me: alice, role: 'owner' },
    actions,
    onClose: vi.fn(),
    ...over,
  };
  return { props, ...render(<CommentPanel {...props} />) };
}

describe('CommentPanel', () => {
  it('puts hidden and orphaned threads only in their own groups', () => {
    panel();
    const normal = screen.getByTestId('panel-group-normal');
    const hidden = screen.getByTestId('panel-group-hidden');
    const orphaned = screen.getByTestId('panel-group-orphaned');
    expect(
      within(normal)
        .getAllByText(/^#\d$/)
        .map((e) => e.textContent),
    ).toEqual(['#1', '#4']);
    expect(within(hidden).getByText('#2')).toBeInTheDocument();
    expect(within(hidden).getByText('目前狀態不可見')).toBeInTheDocument();
    expect(within(orphaned).getByText('#3')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /孤兒評論/ })).toBeInTheDocument();
  });

  it('hidden thread expands inline with stateHint and a reply box', async () => {
    const user = userEvent.setup();
    const { props } = panel();
    const row = within(screen.getByTestId('panel-group-hidden')).getByRole('button', {
      name: /#2/,
    });
    expect(row).toHaveAttribute('aria-expanded', 'false');
    await user.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/頁面狀態 #modal/)).toBeInTheDocument();
    const hidden = screen.getByTestId('panel-group-hidden');
    await user.type(within(hidden).getByRole('textbox', { name: '回覆' }), 'ok');
    await user.click(within(hidden).getByRole('button', { name: '回覆' }));
    expect(actions.onReply).toHaveBeenCalledWith(expect.objectContaining({ id: 't2' }), 'ok');
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it('clicking a normal item selects it (page/width switch + card are the container’s job)', async () => {
    const user = userEvent.setup();
    const { props } = panel();
    await user.click(screen.getByRole('button', { name: /#1/ }));
    expect(props.onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }));
  });

  it('applies filters (status, author, tag, width)', () => {
    panel({ filters: { ...DEFAULT_THREAD_FILTERS, status: 'resolved' } });
    expect(screen.queryByText('#1')).toBeNull();
    expect(screen.getByText('#4')).toBeInTheDocument();
  });

  it('filters by author, tag and current width', () => {
    const { rerender, props } = panel({ filters: { ...DEFAULT_THREAD_FILTERS, authorId: 'g1' } });
    expect(screen.getAllByText(/^#\d$/).map((e) => e.textContent)).toEqual(['#4']);
    rerender(<CommentPanel {...props} filters={{ ...DEFAULT_THREAD_FILTERS, tag: 'bug' }} />);
    expect(screen.getAllByText(/^#\d$/).map((e) => e.textContent)).toEqual(['#4']);
    rerender(<CommentPanel {...props} filters={{ ...DEFAULT_THREAD_FILTERS, width: 390 }} />);
    expect(screen.getByText('沒有符合條件的留言。')).toBeInTheDocument();
  });

  it('arrow keys move focus between rows', async () => {
    const user = userEvent.setup();
    panel();
    const rows = screen.getAllByRole('button').filter((b) => b.hasAttribute('data-panel-row'));
    rows[0]!.focus();
    await user.keyboard('{ArrowDown}');
    expect(rows[1]).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(rows[0]).toHaveFocus();
  });

  it('close button collapses the panel', async () => {
    const user = userEvent.setup();
    const { props } = panel();
    await user.click(screen.getByRole('button', { name: '收合留言面板' }));
    expect(props.onClose).toHaveBeenCalled();
  });
});

describe('Filters', () => {
  it('emits patches for each control', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Filters
        filters={DEFAULT_THREAD_FILTERS}
        onChange={onChange}
        pages={['index.html', 'about.html']}
        authors={[{ id: 'u1', name: 'Alice' }]}
        currentWidth={768}
      />,
    );
    await user.selectOptions(screen.getByLabelText('狀態'), 'open');
    expect(onChange).toHaveBeenLastCalledWith({ status: 'open' });
    await user.selectOptions(screen.getByLabelText('頁面'), 'about.html');
    expect(onChange).toHaveBeenLastCalledWith({ pageId: 'about.html' });
    await user.selectOptions(screen.getByLabelText('寬度'), 'current');
    expect(onChange).toHaveBeenLastCalledWith({ width: 768 });
    await user.selectOptions(screen.getByLabelText('作者'), 'u1');
    expect(onChange).toHaveBeenLastCalledWith({ authorId: 'u1' });
    await user.selectOptions(screen.getByLabelText('標籤'), 'design');
    expect(onChange).toHaveBeenLastCalledWith({ tag: 'design' });
  });
});
