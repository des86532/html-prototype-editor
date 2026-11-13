import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { alice, bob } from '@/test-utils/fixtures';
import { PinOverlay } from './PinOverlay';
import type { PinItem } from './pinLayout';

const pin = (over: Partial<PinItem> = {}): PinItem => ({
  id: 't1',
  number: 12,
  author: alice,
  kind: 'element',
  anchorStatus: 'exact',
  draft: false,
  resolved: false,
  point: { x: 100, y: 100 },
  box: null,
  summary: {
    authorName: 'Alice Chen',
    createdAt: '2026-01-01T00:00:00Z',
    body: 'line1\nline2\nline3',
    replyCount: 2,
  },
  ...over,
});

const view = { w: 800, h: 600 };
const noop = () => undefined;

describe('Pin appearance', () => {
  it('is a button with aria-label "評論 #12：…" and aria-expanded', () => {
    render(
      <PinOverlay
        pins={[pin()]}
        viewport={view}
        openId={null}
        onPinClick={noop}
        onEdgeClick={noop}
      />,
    );
    const b = screen.getByRole('button', { name: '評論 #12：line1 line2 line3' });
    expect(b).toHaveAttribute('aria-expanded', 'false');
    expect(b).toHaveTextContent('AC');
    expect(b).toHaveTextContent('#12');
  });

  it('is 28px (size-7) and the tail tip lands on the anchor point; not scaled', () => {
    render(
      <PinOverlay
        pins={[pin()]}
        viewport={view}
        openId={null}
        onPinClick={noop}
        onEdgeClick={noop}
      />,
    );
    const wrap = screen.getByTestId('pin-t1');
    expect(wrap.style.width).toBe('28px');
    expect(wrap.style.height).toBe('28px');
    expect(wrap.style.left).toBe('86px'); // 100 - 14
    expect(wrap.style.top).toBe('66px'); // 100 - 28 - 6 (tail)
  });

  it('fuzzy gets a dashed outline; fallback is grey with a warning; resolved/draft are faded', () => {
    render(
      <PinOverlay
        pins={[
          pin({ id: 'f', anchorStatus: 'fuzzy', number: 1 }),
          pin({ id: 'g', anchorStatus: 'fallback', number: 2, point: { x: 200, y: 100 } }),
          pin({ id: 'r', resolved: true, number: 3, point: { x: 300, y: 100 } }),
          pin({ id: 'd', draft: true, number: null, point: { x: 400, y: 100 } }),
        ]}
        viewport={view}
        openId={null}
        onPinClick={noop}
        onEdgeClick={noop}
      />,
    );
    expect(screen.getByRole('button', { name: /#1：/ }).className).toContain('outline-dashed');
    const grey = screen.getByRole('button', { name: /#2：/ });
    expect(grey.style.backgroundColor).toBe('rgb(139, 141, 152)');
    expect(grey).toHaveTextContent('⚠');
    expect(screen.getByRole('button', { name: /#3：/ }).className).toContain('opacity-60');
    expect(screen.getByRole('button', { name: '新留言（草稿）' }).className).toContain(
      'opacity-50',
    );
  });

  it('region and text pins draw a translucent box', () => {
    render(
      <PinOverlay
        pins={[
          pin({ id: 'reg', kind: 'region', box: { x: 10, y: 10, w: 100, h: 50 } }),
          pin({ id: 'txt', kind: 'text', box: { x: 10, y: 80, w: 100, h: 14 }, number: 2 }),
        ]}
        viewport={view}
        openId={null}
        onPinClick={noop}
        onEdgeClick={noop}
      />,
    );
    expect(screen.getByTestId('pin-box-reg')).toHaveAttribute('data-kind', 'region');
    expect(screen.getByTestId('pin-box-txt')).toHaveAttribute('data-kind', 'text');
    expect(screen.getByTestId('pin-box-reg').className).toContain('pointer-events-none');
  });

  it('uses the author-hash colour (same author → same colour)', () => {
    render(
      <PinOverlay
        pins={[
          pin({ id: 'a' }),
          pin({ id: 'b', point: { x: 200, y: 100 }, number: 13 }),
          pin({ id: 'c', author: bob, point: { x: 300, y: 100 }, number: 14 }),
        ]}
        viewport={view}
        openId={null}
        onPinClick={noop}
        onEdgeClick={noop}
      />,
    );
    const colour = (n: number) =>
      screen.getByRole('button', { name: new RegExp(`#${n}：`) }).style.backgroundColor;
    expect(colour(12)).toBe(colour(13));
  });
});

describe('hover preview', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('appears after 300 ms hover with author, first 2 lines and reply count; disappears on leave', () => {
    render(
      <PinOverlay
        pins={[pin()]}
        viewport={view}
        openId={null}
        onPinClick={noop}
        onEdgeClick={noop}
      />,
    );
    const b = screen.getByRole('button', { name: /#12：/ });
    fireEvent.pointerEnter(b);
    act(() => void vi.advanceTimersByTime(299));
    expect(screen.queryByTestId('pin-preview')).toBeNull();
    act(() => void vi.advanceTimersByTime(2));
    const p = screen.getByTestId('pin-preview');
    expect(p).toHaveTextContent('Alice Chen');
    expect(p).toHaveTextContent('line1');
    expect(p).toHaveTextContent('line2');
    expect(p).not.toHaveTextContent('line3');
    expect(p).toHaveTextContent('2 則回覆');
    fireEvent.pointerLeave(b);
    expect(screen.queryByTestId('pin-preview')).toBeNull();
  });

  it('is not shown while the card is open, and not for a quick pass-through', () => {
    const { rerender } = render(
      <PinOverlay
        pins={[pin()]}
        viewport={view}
        openId={null}
        onPinClick={noop}
        onEdgeClick={noop}
      />,
    );
    const b = screen.getByRole('button', { name: /#12：/ });
    fireEvent.pointerEnter(b);
    act(() => void vi.advanceTimersByTime(100));
    fireEvent.pointerLeave(b);
    act(() => void vi.advanceTimersByTime(500));
    expect(screen.queryByTestId('pin-preview')).toBeNull();
    fireEvent.pointerEnter(b);
    rerender(
      <PinOverlay
        pins={[pin()]}
        viewport={view}
        openId="t1"
        onPinClick={noop}
        onEdgeClick={noop}
      />,
    );
    act(() => void vi.advanceTimersByTime(400));
    expect(screen.queryByTestId('pin-preview')).toBeNull();
  });

  it('renders hostile author/body text as text only', () => {
    render(
      <PinOverlay
        pins={[
          pin({
            summary: {
              authorName: '<b>x</b>',
              createdAt: '',
              body: '<img src=x onerror=alert(1)>',
              replyCount: 0,
            },
          }),
        ]}
        viewport={view}
        openId={null}
        onPinClick={noop}
        onEdgeClick={noop}
      />,
    );
    fireEvent.pointerEnter(screen.getByRole('button', { name: /#12：/ }));
    act(() => void vi.advanceTimersByTime(301));
    const p = screen.getByTestId('pin-preview');
    expect(p.querySelector('img, b')).toBeNull();
    expect(p).toHaveTextContent('<b>x</b>');
  });
});
