import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { makeThread } from '@/test-utils/fixtures';
import { MarkupCanvas, type MarkupCanvasProps } from './MarkupCanvas';

function setup(over: Partial<MarkupCanvasProps> = {}) {
  const props: MarkupCanvasProps = {
    threads: [],
    scroll: { x: 0, y: 0 },
    frameSize: { w: 1440, h: 900 },
    scale: 1,
    mode: 'markup',
    tool: 'rect',
    color: '#e5484d',
    stroke: 4,
    selectedId: null,
    canManage: () => true,
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    onMove: vi.fn(),
    onScrollBy: vi.fn(),
    onSelectedAnchor: vi.fn(),
    ...over,
  };
  render(<MarkupCanvas {...props} />);
  return props;
}

const drag = (from: [number, number], to: [number, number]) => {
  const el = screen.getByTestId('markup-canvas');
  fireEvent.pointerDown(el, { clientX: from[0], clientY: from[1], button: 0, pointerId: 1 });
  fireEvent.pointerMove(el, { clientX: to[0], clientY: to[1], pointerId: 1 });
  fireEvent.pointerUp(el, { clientX: to[0], clientY: to[1], pointerId: 1 });
};

describe('MarkupCanvas', () => {
  it('maps scroll onto the svg viewBox', () => {
    setup({ scroll: { x: 0, y: 200 } });
    expect(screen.getByTestId('markup-svg')).toHaveAttribute('viewBox', '0 200 1440 900');
  });

  it('renders a numbered badge for threads with a number', () => {
    setup({
      threads: [makeThread(1), makeThread(2, { number: null, comments: [] })],
    });
    const badges = document.querySelectorAll('button[data-markup-id]');
    expect(badges).toHaveLength(1);
    expect(badges[0]!.getAttribute('aria-label')).toContain('#1');
    expect(badges[0]).toHaveTextContent('1');
  });

  it('clicking a badge selects the thread', () => {
    const p = setup({ threads: [makeThread(1)] });
    fireEvent.click(document.querySelector('button[data-markup-id]')!);
    expect(p.onSelect).toHaveBeenCalledWith('t1');
  });

  it('draws a rect with the rect tool', () => {
    const p = setup();
    drag([10, 10], [110, 60]);
    expect(p.onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'rect', x: 10, y: 10, w: 100, h: 50 }),
    );
  });

  it('normalises a rect dragged up-left', () => {
    const p = setup();
    drag([110, 60], [10, 10]);
    expect(p.onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'rect', x: 10, y: 10, w: 100, h: 50 }),
    );
  });

  it('discards a 2px drag', () => {
    const p = setup();
    drag([10, 10], [12, 12]);
    expect(p.onCreate).not.toHaveBeenCalled();
  });

  it('draws an arrow and a pen stroke', () => {
    const p = setup({ tool: 'arrow' });
    drag([10, 10], [110, 10]);
    expect(p.onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'arrow', from: { x: 10, y: 10 }, to: { x: 110, y: 10 } }),
    );
  });

  it('interact mode lets pointer events through', () => {
    setup({ mode: 'interact' });
    expect(screen.getByTestId('markup-canvas')).toHaveStyle({ pointerEvents: 'none' });
  });

  it('does not draw in interact mode', () => {
    const p = setup({ mode: 'interact' });
    drag([10, 10], [110, 60]);
    expect(p.onCreate).not.toHaveBeenCalled();
  });

  it('forwards wheel to onScrollBy', () => {
    const p = setup();
    fireEvent.wheel(screen.getByTestId('markup-canvas'), { deltaX: 3, deltaY: 40 });
    expect(p.onScrollBy).toHaveBeenCalledWith(3, 40);
  });

  it('select tool drags a manageable shape and reports the move', () => {
    const p = setup({ tool: 'select', threads: [makeThread(1)] });
    const hit = document.querySelector('[data-thread-id="t1"] rect[stroke="transparent"]')!;
    fireEvent.pointerDown(hit, { clientX: 10, clientY: 20, button: 0, pointerId: 1 });
    const el = screen.getByTestId('markup-canvas');
    fireEvent.pointerMove(el, { clientX: 40, clientY: 50, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 40, clientY: 50, pointerId: 1 });
    expect(p.onSelect).toHaveBeenCalledWith('t1');
    expect(p.onMove).toHaveBeenCalledWith(
      expect.objectContaining({ id: 't1' }),
      expect.objectContaining({ kind: 'rect', x: 40, y: 40 }),
    );
  });

  it('select tool on empty space clears the selection', () => {
    const p = setup({ tool: 'select', selectedId: 't1', threads: [makeThread(1)] });
    fireEvent.pointerDown(screen.getByTestId('markup-svg'), {
      clientX: 900,
      clientY: 800,
      button: 0,
    });
    expect(p.onSelect).toHaveBeenCalledWith(null);
  });

  it('text tool opens an input and creates on Enter', () => {
    const p = setup({ tool: 'text' });
    drag([30, 40], [30, 40]);
    const input = screen.getByLabelText('標記文字');
    fireEvent.change(input, { target: { value: ' hello ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(p.onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'text', x: 30, y: 40, text: 'hello' }),
    );
    expect(screen.queryByLabelText('標記文字')).toBeNull();
  });
});
