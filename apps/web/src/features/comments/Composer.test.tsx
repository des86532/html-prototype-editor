import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CommentAssistContext } from './CommentAssistContext';
import { Composer } from './Composer';

function setup(onEscape = vi.fn()) {
  const onSubmit = vi.fn();
  render(
    <CommentAssistContext.Provider
      value={{ candidates: [{ id: 'g1', name: 'Guest Gina' }], names: ['Guest Gina'] }}
    >
      <Composer label="回覆" onSubmit={onSubmit} onEscape={onEscape} autoFocus />
    </CommentAssistContext.Provider>,
  );
  return { onEscape, onSubmit, box: screen.getByLabelText('回覆') as HTMLTextAreaElement };
}

describe('Composer # and @ assists', () => {
  it('# opens the swatch list; ArrowDown + Enter inserts the second preset', async () => {
    const user = userEvent.setup();
    const { box } = setup();
    await user.type(box, '#');
    expect(screen.getByRole('listbox', { name: '選擇顏色' })).toBeInTheDocument();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(box.value).toBe('#f76b15');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('@ lists matching people; Enter inserts "@name "', async () => {
    const user = userEvent.setup();
    const { box } = setup();
    await user.type(box, '@gu');
    const list = screen.getByRole('listbox', { name: '提及成員' });
    expect(list).toHaveTextContent('Guest Gina');
    await user.keyboard('{Enter}');
    expect(box.value).toBe('@Guest Gina ');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('clicking an option inserts it and keeps focus in the textarea', async () => {
    const user = userEvent.setup();
    const { box } = setup();
    await user.type(box, 'hi @');
    await user.click(screen.getByRole('option', { name: /Guest Gina/ }));
    expect(box.value).toBe('hi @Guest Gina ');
    expect(box).toHaveFocus();
  });

  it('Escape closes only the panel; a second Escape reaches onEscape', async () => {
    const user = userEvent.setup();
    const { box, onEscape } = setup();
    await user.type(box, '#');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onEscape).not.toHaveBeenCalled();
    expect(box.value).toBe('#');
    await user.keyboard('{Escape}');
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('no panel when nobody matches the @ query', async () => {
    const user = userEvent.setup();
    const { box } = setup();
    await user.type(box, '@zzz');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(box.value).toBe('@zzz');
  });

  it('⌘+Enter submits even while the panel is open', async () => {
    const user = userEvent.setup();
    const { box, onSubmit } = setup();
    await user.type(box, 'ok #');
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(onSubmit).toHaveBeenCalledWith('ok #');
  });
});
