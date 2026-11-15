import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  DEVICE_PRESETS,
  FRAME_TIMINGS,
  MESSAGE_LIMITS,
  PROTOCOL_VERSION,
  shapeBounds,
  type FrameToParent,
  type Thread,
} from '@hpe/shared';
import { annotationsToThreads, injectAgent } from '@hpe/exporter/browser';
import type { SingleFilePayload } from '@hpe/exporter/browser';
import { ThreadPopover } from '@web/features/comments/ThreadPopover';
import { useViewerShortcuts } from '@web/features/comments/shortcuts';
import { MarkupCanvas } from '@web/features/markup/MarkupCanvas';
import { MarkupPanel } from '@web/features/markup/MarkupPanel';
import { WidthChips } from '@web/features/markup/WidthChips';
import { FrameWatchdog, useFrameWatchdog } from '@web/features/viewer/FrameWatchdog';
import { fitScale } from '@web/features/viewer/fitScale';
import { useFrameBridge, type BridgeWarning } from '@web/features/viewer/useFrameBridge';
import { truncate } from '@web/lib/format';
import { useElementSize } from '@web/lib/useElementSize';
import { useLatest } from '@web/lib/useLatest';
import { useUiStore } from '@web/state/uiStore';
import { ExportSandboxFrame } from './ExportSandboxFrame';
import { ExportToolbar } from './ExportToolbar';
import { resolvePageRequest } from './navigation';
import { READ_ONLY_ACTIONS, READ_ONLY_ACTOR } from './readOnly';

const TOAST_MS = 4000;

const noop = () => undefined;
const cannotManage = () => false;

/**
 * 單檔匯出 shell 的唯讀 viewer：與 live PrototypeViewer 共用標記畫布／卡片／面板元件與 frame 橋接，
 * 但 prototype 以 `srcdoc` 載入、多頁導覽由 agent 的 `navigateRequest` 驅動換 srcdoc，且沒有任何寫入路徑。
 */
export function ExportViewer({ payload }: { payload: SingleFilePayload }) {
  const ui = useUiStore();
  const { annotations, pages, agentSource, meta } = payload;
  const version = annotations.version;

  const threads = useMemo<Thread[]>(() => annotationsToThreads(annotations), [annotations]);
  const pagePaths = useMemo(() => Object.keys(pages), [pages]);
  const pageInfos = useMemo(
    () => version.pages.filter((p) => p.path in pages),
    [version.pages, pages],
  );

  const initialPage = meta.entryPage in pages ? meta.entryPage : (pagePaths[0] ?? meta.entryPage);
  const [loadedPage, setLoadedPage] = useState(initialPage);
  const [frameKey, setFrameKey] = useState(0);
  const [iframe, setIframe] = useState<HTMLIFrameElement | null>(null);
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const containerSize = useElementSize(containerEl);

  useEffect(() => {
    useUiStore.getState().reset();
    useUiStore.getState().setPageId(initialPage);
    return () => useUiStore.getState().reset();
  }, [initialPage]);

  const [readyPage, setReadyPage] = useState<string | null>(null);
  const [scroll, setScroll] = useState<{ x: number; y: number; vw: number; vh: number } | null>(
    null,
  );
  const [selectedAnchorEl, setSelectedAnchorEl] = useState<HTMLElement | null>(null);
  const [canvasEl, setCanvasEl] = useState<HTMLElement | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const pendingSelectRef = useRef<string | null>(null);
  const lastToastAt = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pagesRef = useLatest(pagePaths);

  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const sendRef = useRef<ReturnType<typeof useFrameBridge>['send']>(() => false);
  const watchdogHandleRef = useRef<(m: FrameToParent) => void>(() => undefined);
  const watchdogResetRef = useRef<() => void>(() => undefined);

  const reloadFrame = useCallback((page: string) => {
    setLoadedPage(page);
    setFrameKey((k) => k + 1);
    watchdogResetRef.current();
    setReadyPage(null);
    setScroll(null);
  }, []);

  const onMessage = useCallback(
    (msg: FrameToParent) => {
      watchdogHandleRef.current(msg);
      switch (msg.type) {
        case 'ready':
          setReadyPage(msg.pageId);
          useUiStore.getState().setPageId(msg.pageId);
          sendRef.current({ v: PROTOCOL_VERSION, type: 'init' });
          break;
        case 'scroll':
          setScroll({ x: msg.x, y: msg.y, vw: msg.vw, vh: msg.vh });
          break;
        case 'navigateRequest': {
          const target = resolvePageRequest(msg.pageId, pagesRef.current);
          if (target) reloadFrame(target);
          else showToast(`匯出檔中找不到頁面：${truncate(msg.pageId, 80)}`);
          break;
        }
        case 'dialog': {
          const now = Date.now();
          if (now - lastToastAt.current < FRAME_TIMINGS.dialogToastThrottleMs) break;
          lastToastAt.current = now;
          showToast(
            `prototype 呼叫了 ${msg.kind}：${truncate(msg.text, MESSAGE_LIMITS.maxDialogTextLength)}`,
          );
          break;
        }
        default:
          // pong（watchdog 已處理）；storageSnapshot 匯出檔不使用。
          break;
      }
    },
    [pagesRef, reloadFrame, showToast],
  );

  const onDropped = useCallback(
    (reason: BridgeWarning) => {
      if (reason === 'rate-limited') showToast('prototype 傳送訊息過於頻繁，已暫停處理。');
      else if (reason === 'too-large') showToast('已丟棄一則過大的 prototype 訊息。');
    },
    [showToast],
  );

  const { send } = useFrameBridge({ iframe, onMessage, onDropped });
  const watchdog = useFrameWatchdog({ iframe, send });
  useLayoutEffect(() => {
    sendRef.current = send;
    watchdogHandleRef.current = watchdog.handleMessage;
    watchdogResetRef.current = watchdog.reset;
  });

  const { width, height } = ui.device;

  /* ---------------- 標記 ---------------- */
  const visible = useMemo(
    () =>
      threads.filter(
        (t) =>
          ui.showMarkups &&
          readyPage !== null &&
          t.markup.pageId === readyPage &&
          t.markup.viewport.width === width &&
          (ui.showResolved || t.status === 'open' || t.id === ui.selectedId),
      ),
    [threads, ui.showMarkups, ui.showResolved, ui.selectedId, readyPage, width],
  );
  const markupCount = useMemo(() => threads.filter((t) => t.number !== null).length, [threads]);

  const jumpTo = useCallback(
    (thread: Thread) => {
      const s = useUiStore.getState();
      const w = thread.markup.viewport.width;
      if (w !== s.device.width) {
        const preset = DEVICE_PRESETS.find((p) => p.width === w);
        s.setDevice(
          preset
            ? { presetId: preset.id, width: preset.width, height: preset.height }
            : { presetId: 'custom', width: w, height: thread.markup.viewport.height },
        );
      }
      if (thread.markup.pageId !== readyPage) {
        pendingSelectRef.current = thread.id;
        reloadFrame(thread.markup.pageId);
        return;
      }
      const b = shapeBounds(thread.markup.shape);
      const vw = scroll?.vw ?? w;
      const vh = scroll?.vh ?? thread.markup.viewport.height;
      send({
        v: PROTOCOL_VERSION,
        type: 'scrollTo',
        x: Math.max(0, b.x + b.w / 2 - vw / 2),
        y: Math.max(0, b.y + b.h / 2 - vh / 2),
      });
      s.select(thread.id);
    },
    [readyPage, reloadFrame, scroll, send],
  );

  // 面板選取跨頁時：等新頁面載入並收到第一則 scroll（agent 已可捲動）後才選取。
  useEffect(() => {
    const id = pendingSelectRef.current;
    if (!id || readyPage === null || scroll === null) return;
    const t = threads.find((x) => x.id === id);
    pendingSelectRef.current = null;
    if (!t || t.markup.pageId !== readyPage) return;
    jumpTo(t);
  }, [threads, readyPage, scroll, jumpTo]);

  const navigableIds = useMemo(
    () =>
      visible
        .filter((t): t is Thread & { number: number } => t.number !== null)
        .sort((a, b) => a.number - b.number)
        .map((t) => t.id),
    [visible],
  );
  const escape = useCallback(() => {
    const id = useUiStore.getState().selectedId;
    if (id === null) return false;
    useUiStore.getState().select(null);
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(`[data-markup-id="${CSS.escape(id)}"]`)?.focus(),
    );
    return true;
  }, []);
  useViewerShortcuts({
    canMarkup: false,
    mode: 'interact',
    navigableIds,
    selectedId: ui.selectedId,
    toggleMode: noop,
    toggleShowMarkups: () => useUiStore.getState().toggleShowMarkups(),
    escape,
    select: (id) => {
      const t = threads.find((x) => x.id === id);
      if (t) jumpTo(t);
    },
    setTool: noop,
    deleteSelected: noop,
    undo: noop,
  });

  const selected = visible.find((t) => t.id === ui.selectedId) ?? null;
  const outOfView = useMemo(() => {
    if (!selected || !scroll) return false;
    const b = shapeBounds(selected.markup.shape);
    return (
      b.x + b.w < scroll.x ||
      b.x > scroll.x + scroll.vw ||
      b.y + b.h < scroll.y ||
      b.y > scroll.y + scroll.vh
    );
  }, [selected, scroll]);

  /* ---------------- 版面 ---------------- */
  const scale = ui.fit ? fitScale(containerSize, ui.device) : 1;
  const srcDoc = useMemo(
    () => injectAgent(pages[loadedPage] ?? '', agentSource, loadedPage),
    [pages, loadedPage, agentSource],
  );

  return (
    <div className="flex h-dvh flex-col bg-stage" data-testid="export-viewer">
      <header className="flex items-center gap-3 border-b border-line bg-surface px-3 py-2">
        <h1 className="truncate text-sm font-semibold">
          {meta.projectName} · v{meta.versionNumber}
        </h1>
        <span role="note" className="chip chip-muted">
          唯讀匯出檔 · 無網路
        </span>
      </header>
      <ExportToolbar
        device={ui.device}
        onDevice={ui.setDevice}
        fit={ui.fit}
        onFit={ui.setFit}
        scale={scale}
        showMarkups={ui.showMarkups}
        onShowMarkups={ui.setShowMarkups}
        showResolved={ui.showResolved}
        onShowResolved={ui.setShowResolved}
        panelOpen={ui.panelOpen}
        onPanelOpen={ui.setPanelOpen}
        markupCount={markupCount}
        pages={pageInfos}
        pageId={readyPage ?? loadedPage}
        onPage={reloadFrame}
      />
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <div
            ref={setContainerEl}
            className="stage-grid h-full overflow-auto p-4"
            data-testid="viewer-container"
          >
            <div
              className="relative mx-auto"
              style={{ width: width * scale, height: height * scale }}
            >
              <ExportSandboxFrame
                key={frameKey}
                ref={setIframe}
                srcDoc={srcDoc}
                width={width}
                height={height}
                scale={scale}
              />
              <MarkupCanvas
                threads={visible}
                scroll={scroll ?? { x: 0, y: 0 }}
                frameSize={{ w: width, h: height }}
                scale={scale}
                mode="interact"
                tool="select"
                color={ui.color}
                stroke={ui.stroke}
                selectedId={ui.selectedId}
                canManage={cannotManage}
                onSelect={ui.select}
                onCreate={noop}
                onMove={noop}
                onScrollBy={(dx, dy) => send({ v: PROTOCOL_VERSION, type: 'scrollBy', dx, dy })}
                onSelectedAnchor={setSelectedAnchorEl}
                onRootEl={setCanvasEl}
              />
              {selected && (
                <ThreadPopover
                  thread={selected}
                  referenceEl={selectedAnchorEl}
                  boundary={containerEl}
                  hidden={outOfView}
                  actor={READ_ONLY_ACTOR}
                  actions={READ_ONLY_ACTIONS}
                  canDelete={false}
                  onDeleteMarkup={noop}
                  ignoreOutside={canvasEl}
                  onClose={(reason) => {
                    if (reason === 'outside') ui.select(null);
                    else escape();
                  }}
                />
              )}
              <FrameWatchdog
                state={watchdog.state}
                onStop={watchdog.stop}
                onReload={() => reloadFrame(loadedPage)}
              />
            </div>
          </div>
          <WidthChips
            threads={threads}
            pageId={readyPage}
            width={width}
            showResolved={ui.showResolved}
            onPick={(w, h) => {
              const preset = DEVICE_PRESETS.find((p) => p.width === w);
              ui.setDevice(
                preset
                  ? { presetId: preset.id, width: preset.width, height: preset.height }
                  : { presetId: 'custom', width: w, height: h },
              );
            }}
          />
          {toast && (
            <div
              role="status"
              className="fixed bottom-4 left-1/2 z-50 max-w-md -translate-x-1/2 rounded-md bg-ink px-3 py-2 text-sm text-white shadow-lg"
            >
              {toast}
            </div>
          )}
        </div>
        {ui.panelOpen && (
          <MarkupPanel
            threads={threads}
            pages={pagePaths}
            showResolved={ui.showResolved}
            selectedId={ui.selectedId}
            onSelect={jumpTo}
            onClose={() => ui.setPanelOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
