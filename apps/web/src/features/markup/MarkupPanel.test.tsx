import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { makeMarkup, makeThread } from '@/test-utils/fixtures';
import { MarkupPanel } from './MarkupPanel';

describe('MarkupPanel', () => {
  it('labels page groups by <title>, falling back to the path', () => {
    render(
      <MarkupPanel
        threads={[
          makeThread(1, { markup: makeMarkup({ pageId: 'pricing.html' }) }),
          makeThread(2, { markup: makeMarkup({ pageId: 'index.html' }) }),
          makeThread(3, { markup: makeMarkup({ pageId: 'gone.html' }) }),
        ]}
        pages={[
          { path: 'index.html', title: 'Home' },
          { path: 'pricing.html', title: null },
        ]}
        showResolved
        selectedId={null}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const headings = screen.getAllByRole('heading', { level: 3 });
    // 依 pages 順序，未知頁面排最後
    expect(headings.map((h) => h.getAttribute('title'))).toEqual([
      'index.html',
      'pricing.html',
      'gone.html',
    ]);
    expect(headings[0]).toHaveTextContent('Home');
    expect(headings[1]).toHaveTextContent('pricing.html');
    expect(headings[2]).toHaveTextContent('gone.html');
  });
});
