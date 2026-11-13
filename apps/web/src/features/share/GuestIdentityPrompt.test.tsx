import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COMMENT_LIMITS } from '@hpe/shared';
import { GuestIdentityPrompt } from './GuestIdentityPrompt';

afterEach(cleanup);

describe('GuestIdentityPrompt', () => {
  it('rejects empty name', async () => {
    const onSubmit = vi.fn();
    render(<GuestIdentityPrompt onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole('button', { name: '開始留言' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('請輸入名字');
  });

  it('rejects whitespace-only and too long names', async () => {
    const onSubmit = vi.fn();
    render(<GuestIdentityPrompt onSubmit={onSubmit} />);
    const input = screen.getByLabelText('你的名字');
    await userEvent.type(input, '   ');
    await userEvent.click(screen.getByRole('button', { name: '開始留言' }));
    expect(onSubmit).not.toHaveBeenCalled();
    await userEvent.clear(input);
    await userEvent.click(input);
    await userEvent.paste('a'.repeat(COMMENT_LIMITS.maxGuestNameLength + 1));
    await userEvent.click(screen.getByRole('button', { name: '開始留言' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits trimmed name; shows external error; has dialog role', async () => {
    const onSubmit = vi.fn();
    render(<GuestIdentityPrompt onSubmit={onSubmit} error="失敗了" initialName="  Amy " />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('失敗了')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '開始留言' }));
    expect(onSubmit).toHaveBeenCalledWith('Amy');
  });
});
