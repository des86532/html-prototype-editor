import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildAnnotationsDocument } from '../../exporter/src/json';
import { makeAnchor, makeInput, makeThread } from '../../exporter/src/fixtures';
import type { SingleFilePayload } from '@hpe/exporter/browser';
import { ExportViewer } from './ExportViewer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const threads = [
  makeThread(1),
  makeThread(2, { status: 'resolved', resolvedAt: '2026-02-02T00:00:00Z' }),
  makeThread(3, { anchor: makeAnchor({ pageId: 'pricing.html' }) }),
];
const payload: SingleFilePayload = {
  format: 'hpe-single-file',
  formatVersion: 1,
  meta: { projectName: 'Demo', versionNumber: 3, entryPage: 'index.html', exportedAt: 'x' },
  annotations: buildAnnotationsDocument(makeInput(threads)),
  pages: { 'index.html': '<html><head></head><body>a</body></html>', 'pricing.html': '<p>p</p>' },
  agentSource: 'window.__agent=1;',
};

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('ExportViewer', () => {
  it('renders the fixed-attribute sandbox iframe with srcdoc (agent + export flag first in head)', () => {
    act(() => root.render(<ExportViewer payload={payload} />));
    const frame = host.querySelector('iframe')!;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('allow')).toBe('');
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frame.hasAttribute('src')).toBe(false);
    const doc = frame.getAttribute('srcdoc')!;
    expect(doc).toContain(
      '<head><script>window.__HPE_EXPORT__=true</script><script data-hpe-page="index.html">window.__agent=1;</script>',
    );
  });

  it('is read-only: no Comment mode button, panel lists threads and filters apply', () => {
    act(() => root.render(<ExportViewer payload={payload} />));
    expect(host.textContent).not.toContain('Comment');
    expect(host.textContent).toContain('唯讀匯出檔');
    const panelBtn = [...host.querySelectorAll('button')].find((b) =>
      b.textContent?.startsWith('留言面板'),
    )!;
    expect(panelBtn.textContent).toContain('（3）');
    act(() => panelBtn.click());
    expect(host.textContent).toContain('first 1');
    expect(host.querySelector('textarea')).toBeNull();
  });
});
