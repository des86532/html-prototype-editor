import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FrameToParent, PrototypeVersion } from '@hpe/shared';
import type { Api } from '@/lib/api';
import { useUiStore } from '@/state/uiStore';
import { alice, makeAnchor, makeThread } from '@/test-utils/fixtures';
import { PrototypeViewer, type PrototypeViewerProps } from './PrototypeViewer';

const version: PrototypeVersion = {
  id: 'v1',
  projectId: 'p1',
  number: 1,
  contentKey: 'abc',
  entryPage: 'index.html',
  pages: [
    { path: 'index.html', title: 'Home' },
    { path: 'about.html', title: null },
  ],
  cdnAllowlist: [],
  analysis: {
    scripts: { inline: 0, external: [] },
    externalResources: [],
    forms: 0,
    passwordInputs: 0,
    iframes: [],
    metaRefresh: false,
    baseTag: false,
    serviceWorkerRegistration: false,
    warnings: [],
  },
  status: 'ready',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const t1 = makeThread(1);

function mount(over: Partial<PrototypeViewerProps> = {}, threads = [t1]) {
  const api = { listThreads: vi.fn().mockResolvedValue({ threads }) } as unknown as Api;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PrototypeViewer
        version={version}
        projectName="Demo"
        actor={{ me: alice, role: 'owner' }}
        buildThreadUrl={(t) => `http://x/?thread=${t.id}`}
        api={api}
        srcOverride="about:blank"
        {...over}
      />
    </QueryClientProvider>,
  );
  const iframe = screen.getByTitle(/Prototype 預覽/) as HTMLIFrameElement;
  const win = iframe.contentWindow!;
  const post = vi.spyOn(win, 'postMessage').mockImplementation(() => undefined);
  const fromFrame = (msg: FrameToParent) =>
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: msg, source: win }));
    });
  const sent = () => post.mock.calls.map((c) => c[0] as { type: string } & Record<string, unknown>);
  return { api, iframe, post, fromFrame, sent };
}

const ready = (pageId = 'index.html'): FrameToParent => ({
  v: 1,
  type: 'ready',
  agentVersion: '1',
  pageId,
  hash: '',
  docSize: { w: 1440, h: 3000 },
});

beforeEach(() => useUiStore.getState().reset());
afterEach(() => useUiStore.getState().reset());

describe('PrototypeViewer', () => {
  it('always shows the 不受信任內容 badge and the sandboxed frame', () => {
    const { iframe } = mount();
    expect(screen.getByRole('note')).toHaveTextContent('不受信任內容');
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');
  });

  it('on ready: init → resolveAnchors for the page’s threads → trackAnchors', async () => {
    const other = makeThread(2, { anchor: makeAnchor({ pageId: 'about.html' }) });
    const { fromFrame, sent, api } = mount({}, [t1, other]);
    await waitFor(() => expect(api.listThreads).toHaveBeenCalled());
    fromFrame(ready());
    await waitFor(() => expect(sent().map((m) => m.type)).toContain('trackAnchors'));
    const msgs = sent();
    expect(msgs[0]).toMatchObject({ type: 'init', mode: 'interact' });
    const resolve = msgs.find((m) => m.type === 'resolveAnchors') as unknown as {
      anchors: { threadId: string }[];
    };
    expect(resolve.anchors.map((a) => a.threadId)).toEqual(['t1']);
    const track = msgs.find((m) => m.type === 'trackAnchors') as unknown as { threadIds: string[] };
    expect(track.threadIds).toEqual(['t1']);
    // comment bodies / authors never cross into the frame
    expect(JSON.stringify(msgs)).not.toContain('comment 1');
    expect(JSON.stringify(msgs)).not.toContain('Alice');
  });

  it('draws a pin from anchorsResolved and moves it on geometry updates', async () => {
    const { fromFrame, api } = mount();
    await waitFor(() => expect(api.listThreads).toHaveBeenCalled());
    fromFrame(ready());
    fromFrame({
      v: 1,
      type: 'anchorsResolved',
      requestId: '1',
      results: [
        { threadId: 't1', status: 'exact', confidence: 1, rect: { x: 100, y: 100, w: 100, h: 40 } },
      ],
    });
    const pin = await screen.findByTestId('pin-t1');
    const y0 = Number(pin.dataset.y);
    fromFrame({
      v: 1,
      type: 'geometry',
      viewport: { w: 1440, h: 900 },
      rects: { t1: { x: 100, y: 50, w: 100, h: 40 } },
    });
    await waitFor(() =>
      expect(Number(screen.getByTestId('pin-t1').dataset.y)).toBeCloseTo(y0 - 50),
    );
  });

  it('comment mode: C key sends setMode; a pick creates the draft pin + composer; interact mode ignores picks', async () => {
    const user = userEvent.setup();
    const { fromFrame, sent } = mount();
    fromFrame(ready());
    const pick: FrameToParent = {
      v: 1,
      type: 'pick',
      draft: makeAnchor(),
      rect: { x: 200, y: 300, w: 60, h: 20 },
    };
    fromFrame(pick);
    expect(screen.queryByTestId('pin-draft')).toBeNull(); // interact mode
    await user.keyboard('c');
    expect(useUiStore.getState().mode).toBe('comment');
    await waitFor(() =>
      expect(sent().some((m) => m.type === 'setMode' && m.mode === 'comment')).toBe(true),
    );
    fromFrame(pick);
    expect(await screen.findByTestId('pin-draft')).toBeInTheDocument();
    expect(await screen.findByRole('dialog', { name: '新增留言' })).toBeInTheDocument();
    // the draft is tracked so it follows scrolling
    await waitFor(() =>
      expect(
        sent().some(
          (m) => m.type === 'trackAnchors' && (m.threadIds as string[]).includes('__draft__'),
        ),
      ).toBe(true),
    );
  });

  it('viewer role: Comment mode is disabled and C does nothing', async () => {
    const user = userEvent.setup();
    mount({ actor: { me: null, role: 'viewer' } });
    expect(screen.getByRole('button', { name: /^Comment/ })).toBeDisabled();
    await user.keyboard('c');
    expect(useUiStore.getState().mode).toBe('interact');
  });

  it('toolbar: 顯示留言 / 顯示已解決 / 留言面板 toggles', async () => {
    const user = userEvent.setup();
    mount();
    expect(screen.getByRole('button', { name: '顯示已解決' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.queryByTestId('comment-panel')).toBeNull();
    await user.click(screen.getByRole('button', { name: /^留言面板/ }));
    expect(screen.getByTestId('comment-panel')).toBeInTheDocument();
    await user.keyboard('{Shift>}C{/Shift}');
    expect(useUiStore.getState().showComments).toBe(false);
    expect(screen.getByRole('button', { name: '顯示留言' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('dialog messages become plain-text toasts (throttled)', () => {
    const { fromFrame } = mount();
    fromFrame(ready());
    fromFrame({ v: 1, type: 'dialog', kind: 'alert', text: '<img src=x onerror=alert(1)>' });
    const toast = screen.getByRole('status');
    expect(toast).toHaveTextContent('<img src=x onerror=alert(1)>');
    expect(toast.querySelector('img')).toBeNull();
  });

  it('remembers storageSnapshot and re-sends it as storageSeed on the next ready', () => {
    const { fromFrame, sent } = mount();
    fromFrame(ready());
    fromFrame({ v: 1, type: 'storageSnapshot', data: '{"k":"v"}' });
    fromFrame(ready('about.html'));
    const inits = sent().filter((m) => m.type === 'init');
    expect(inits[0]).not.toHaveProperty('storageSeed');
    expect(inits[1]).toMatchObject({ storageSeed: '{"k":"v"}' });
    expect(useUiStore.getState().pageId).toBe('about.html');
  });

  it('device presets and custom sizes update the frame size', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Mobile 390' }));
    expect(useUiStore.getState().device).toMatchObject({ presetId: 'mobile-390', width: 390 });
    const w = screen.getByLabelText('自訂寬度');
    await user.clear(w);
    await user.type(w, '500');
    expect(useUiStore.getState().device).toMatchObject({ presetId: 'custom', width: 500 });
  });
});
