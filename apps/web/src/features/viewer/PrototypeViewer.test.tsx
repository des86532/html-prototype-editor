import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FrameToParent, PrototypeVersion } from '@hpe/shared';
import type { Api } from '@/lib/api';
import { useUiStore } from '@/state/uiStore';
import { alice, bob, makeMarkup, makeThread } from '@/test-utils/fixtures';
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
        live={false}
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
});

const scrollMsg = (y: number): FrameToParent => ({
  v: 1,
  type: 'scroll',
  x: 0,
  y,
  docW: 1440,
  docH: 3000,
  vw: 1440,
  vh: 900,
});

beforeEach(() => useUiStore.getState().reset());
afterEach(() => useUiStore.getState().reset());

describe('PrototypeViewer', () => {
  it('always shows the 不受信任內容 badge and the sandboxed frame', () => {
    const { iframe } = mount();
    expect(screen.getByRole('note')).toHaveTextContent('不受信任內容');
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');
  });

  it('the toolbar can be collapsed and expanded again', async () => {
    mount();
    const user = userEvent.setup();
    expect(screen.getByRole('toolbar', { name: 'Viewer 工具列' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '收合工具列' }));
    expect(screen.queryByRole('toolbar', { name: 'Viewer 工具列' })).toBeNull();
    expect(screen.getByRole('button', { name: '展開工具列' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await user.click(screen.getByRole('button', { name: '展開工具列' }));
    expect(screen.getByRole('toolbar', { name: 'Viewer 工具列' })).toBeInTheDocument();
    useUiStore.getState().setToolbarCollapsed(false);
  });

  it('on ready: sends init without a mode and never sends comment text into the frame', async () => {
    const { fromFrame, sent, api } = mount();
    await waitFor(() => expect(api.listThreads).toHaveBeenCalled());
    fromFrame(ready());
    await waitFor(() => expect(sent().map((m) => m.type)).toContain('init'));
    const msgs = sent();
    expect(msgs[0]).toMatchObject({ type: 'init' });
    expect(msgs[0]).not.toHaveProperty('mode');
    expect(JSON.stringify(msgs)).not.toContain('comment 1');
    expect(JSON.stringify(msgs)).not.toContain('Alice');
  });

  it('updates the markup svg viewBox from scroll messages and only shows this page/width', async () => {
    const other = makeThread(2, { markup: makeMarkup({ pageId: 'about.html' }) });
    const { fromFrame, api } = mount({}, [t1, other]);
    await waitFor(() => expect(api.listThreads).toHaveBeenCalled());
    fromFrame(ready());
    fromFrame(scrollMsg(0));
    const svg = await screen.findByTestId('markup-svg');
    expect(svg).toHaveAttribute('viewBox', '0 0 1440 900');
    fromFrame(scrollMsg(200));
    await waitFor(() => expect(svg).toHaveAttribute('viewBox', '0 200 1440 900'));
    expect(document.querySelectorAll('[data-markup-id]')).toHaveLength(1);
    expect(document.querySelector('[data-markup-id="t1"]')).not.toBeNull();
  });

  it('markup mode: C key toggles it and shows the tool palette; interact mode hides it', async () => {
    const user = userEvent.setup();
    mount();
    expect(screen.queryByRole('toolbar', { name: '標記工具' })).toBeNull();
    await user.keyboard('c');
    expect(useUiStore.getState().mode).toBe('markup');
    expect(screen.getByRole('toolbar', { name: '標記工具' })).toBeInTheDocument();
    await user.keyboard('r');
    expect(useUiStore.getState().tool).toBe('rect');
    await user.keyboard('{Escape}');
    expect(useUiStore.getState().mode).toBe('interact');
  });

  it('viewer role: 標記 mode is disabled and C does nothing', async () => {
    const user = userEvent.setup();
    mount({ actor: { me: null, role: 'viewer' } });
    expect(screen.getByRole('button', { name: /^標記（C）/ })).toBeDisabled();
    await user.keyboard('c');
    expect(useUiStore.getState().mode).toBe('interact');
  });

  it('a guest without edit rights cannot manage others’ markups', async () => {
    const { fromFrame, api } = mount({ actor: { me: bob, role: 'commenter' } });
    await waitFor(() => expect(api.listThreads).toHaveBeenCalled());
    fromFrame(ready());
    fromFrame(scrollMsg(0));
    const badge = await screen.findByRole('button', { name: /標記 #1/ });
    fireEvent.click(badge);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '刪除標記' })).toBeNull();
  });

  it('toolbar: 顯示標記 / 顯示已解決 / 標記面板 toggles', async () => {
    const user = userEvent.setup();
    mount();
    expect(screen.getByRole('button', { name: '顯示已解決' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.queryByTestId('markup-panel')).toBeNull();
    await user.click(screen.getByRole('button', { name: /^標記面板/ }));
    expect(screen.getByTestId('markup-panel')).toBeInTheDocument();
    await user.keyboard('{Shift>}C{/Shift}');
    expect(useUiStore.getState().showMarkups).toBe(false);
    expect(screen.getByRole('button', { name: '顯示標記' })).toHaveAttribute(
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
