import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';

afterEach(cleanup);

describe('Modal', () => {
  it('renders nothing when closed', () => {
    render(
      <Modal open={false} title="T" onClose={() => {}}>
        x
      </Modal>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is an aria-modal dialog, focuses in, closes on Esc and backdrop, restores focus', async () => {
    const onClose = vi.fn();
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    const { rerender } = render(
      <Modal open title="標題" onClose={onClose}>
        <input aria-label="field" />
      </Modal>,
    );
    const dialog = screen.getByRole('dialog', { name: '標題' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog.contains(document.activeElement)).toBe(true);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.pointer({ keys: '[MouseLeft]', target: screen.getByTestId('modal-backdrop') });
    expect(onClose).toHaveBeenCalledTimes(2);
    rerender(
      <Modal open={false} title="標題" onClose={onClose}>
        <input aria-label="field" />
      </Modal>,
    );
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
