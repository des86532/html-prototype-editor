import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  DEVICE_PRESETS,
  FRAME_TIMINGS,
  MESSAGE_LIMITS,
  PROTOCOL_VERSION,
  type FrameToParent,
  type Rect,
  type Thread,
} from '@hpe/shared';
import { annotationsToThreads, injectAgent } from '@hpe/exporter/browser';
import type { SingleFilePayload } from '@hpe/exporter/browser';
import { CommentPanel, type PanelThread } from '@web/features/comments/CommentPanel';
import { useViewerShortcuts } from '@web/features/comments/shortcuts';
import { FrameWatchdog, useFrameWatchdog } from '@web/features/viewer/FrameWatchdog';
import { ThreadLayer } from '@web/features/viewer/ThreadLayer';
import { effectiveAnchorStatus, type AnchorResult } from '@web/features/viewer/buildPins';
import { useFrameBridge, type BridgeWarning } from '@web/features/viewer/useFrameBridge';
import { truncate } from '@web/lib/format';
import { useLatest } from '@web/lib/useLatest';
import { useUiStore } from '@web/state/uiStore';
import { ExportSandboxFrame } from './ExportSandboxFrame';
import { ExportToolbar } from './ExportToolbar';
import { resolvePageRequest } from './navigation';
import { READ_ONLY_ACTIONS, READ_ONLY_ACTOR, rejectCreateThread } from './readOnly';

const FIT_PADDING_PX = 32;
const TOAST_MS = 4000;

function useElementWidth(el: HTMLElement | null): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return width;
}

/**
 * 單檔匯出 shell 的唯讀 viewer：與 live PrototypeViewer 共用 pin／卡片／面板元件與 frame 橋接，
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
  const containerWidth = useElementWidth(containerEl);

  useEffect(() => {
    useUiStore.getState().reset();
    useUiStore.getState().setPageId(initialPage);
    return () => useUiStore.getState().reset();
  }, [initialPage]);

  const [readyPage, setReadyPage] = useState<string | null>(null);
  const [readyEpoch, setReadyEpoch] = useState(0);
  const [rects, setRects] = useState<Record<string, Rect | null>>({});
  const [results, setResults] = useState<Record<string, AnchorResult>>({});
  const [frameViewport, setFrameViewport] = useState<{ w: number; h: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const resolvedRef = useRef<Set<string>>(new Set());
  const requestSeq = useRef(0);
  const pendingOpenRef = useRef<string | null>(null);
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
    setReadyEpoch(0);
    setRects({});
    setResults({});
  }, []);

  const onMessage = useCallback(
    (msg: FrameToParent) => {
      watchdogHandleRef.current(msg);
      switch (msg.type) {
        case 'ready':
          resolvedRef.current = new Set();
          setRects({});
          setResults({});
          setReadyPage(msg.pageId);
          setReadyEpoch((n) => n + 1);
          useUiStore.getState().setPageId(msg.pageId);
          sendRef.current({ v: PROTOCOL_VERSION, type: 'init', mode: 'interact' });
          break;
        case 'anchorsResolved':
          setResults((prev) => {
            const next = { ...prev };
            for (const r of msg.results)
              next[r.threadId] = { status: r.status, confidence: r.confidence };
            return next;
          });
          setRects((prev) => {
            const next = { ...prev };
            for (const r of msg.results) next[r.threadId] = r.rect;
            return next;
          });
          break;
        case 'geometry':
          setFrameViewport(msg.viewport);
          setRects((prev) => ({ ...prev, ...msg.rects }));
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
          // pong（watchdog 已處理）；hover／pick／described 只在 Comment 模式出現，匯出檔沒有該模式。
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

  /* ---------------- resolve + track ---------------- */
  const pageThreads = useMemo(
    () => threads.filter((t) => readyPage !== null && t.anchor.pageId === readyPage),
    [threads, readyPage],
  );
  const pageIdsKey = pageThreads.map((t) => t.id).join(',');
  useEffect(() => {
    if (readyEpoch === 0 || readyPage === null) return;
    const todo = pageThreads
      .filter((t) => !resolvedRef.current.has(t.id))
      .map((t) => {
        resolvedRef.current.add(t.id);
        return { threadId: t.id, anchor: t.anchor };
      });
    for (let i = 0; i < todo.length; i += MESSAGE_LIMITS.maxAnchorsPerRequest) {
      send({
        v: PROTOCOL_VERSION,
        type: 'resolveAnchors',
        requestId: String(++requestSeq.current),
        anchors: todo.slice(i, i + MESSAGE_LIMITS.maxAnchorsPerRequest),
      });
    }
    send({
      v: PROTOCOL_VERSION,
      type: 'trackAnchors',
      threadIds: pageThreads.map((t) => t.id).slice(0, MESSAGE_LIMITS.maxAnchorsPerRequest),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pageIdsKey 代表 pageThreads 的 id 集合
  }, [readyEpoch, readyPage, pageIdsKey, send]);

  const scrollTo = useCallback(
    (threadId: string) => send({ v: PROTOCOL_VERSION, type: 'scrollToAnchor', threadId }),
    [send],
  );

  const selectThread = useCallback(
    (thread: Thread) => {
      const s = useUiStore.getState();
      const w = Math.round(thread.anchor.viewport.width);
      if (w !== s.device.width) {
        const preset = DEVICE_PRESETS.find((p) => p.width === w);
        s.setDevice(
          preset
            ? { presetId: preset.id, width: preset.width, height: preset.height }
            : {
                presetId: 'custom',
                width: w,
                height: Math.round(thread.anchor.viewport.height) || s.device.height,
              },
        );
      }
      if (thread.anchor.pageId !== readyPage) {
        pendingOpenRef.current = thread.id;
        reloadFrame(thread.anchor.pageId);
      } else {
        scrollTo(thread.id);
        s.openThread(thread.id);
      }
    },
    [readyPage, reloadFrame, scrollTo],
  );

  // 面板選取跨頁時：等新頁面載入、錨點解析後才開卡片。
  useEffect(() => {
    const id = pendingOpenRef.current;
    if (!id || readyPage === null) return;
    const t = threads.find((x) => x.id === id);
    if (!t) {
      pendingOpenRef.current = null;
      return;
    }
    if (t.anchor.pageId !== readyPage || results[id] === undefined) return;
    pendingOpenRef.current = null;
    scrollTo(id);
    useUiStore.getState().openThread(id);
  }, [threads, readyPage, results, scrollTo]);

  const items = useMemo<PanelThread[]>(
    () =>
      threads.map((thread) => ({
        thread,
        anchorStatus: effectiveAnchorStatus(thread, results, pagePaths, readyPage),
      })),
    [threads, results, pagePaths, readyPage],
  );

  const navigableIds = useMemo(
    () =>
      items
        .filter(
          ({ thread, anchorStatus }) =>
            thread.anchor.pageId === readyPage &&
            (anchorStatus === 'exact' || anchorStatus === 'fuzzy' || anchorStatus === 'fallback') &&
            (ui.showResolved || thread.status === 'open'),
        )
        .sort((a, b) => a.thread.number - b.thread.number)
        .map((e) => e.thread.id),
    [items, readyPage, ui.showResolved],
  );
  const closeCard = useCallback(() => {
    const id = useUiStore.getState().openThreadId;
    useUiStore.getState().openThread(null);
    if (id) {
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>(`[data-pin-id="${CSS.escape(id)}"] button`)?.focus(),
      );
    }
  }, []);
  useViewerShortcuts({
    canComment: false,
    navigableIds,
    openId: ui.openThreadId,
    hasDraft: false,
    toggleMode: () => undefined,
    toggleShowComments: () => useUiStore.getState().toggleShowComments(),
    escape: closeCard,
    openThread: (id) => {
      useUiStore.getState().openThread(id);
      scrollTo(id);
    },
    toggleResolveOpen: () => undefined,
  });

  /* ---------------- 版面 ---------------- */
  const { width, height } = ui.device;
  const scale =
    ui.fit && containerWidth > 0 ? Math.min(1, (containerWidth - FIT_PADDING_PX) / width) : 1;
  const viewport = frameViewport ?? { w: width, h: height };
  const srcDoc = useMemo(
    () => injectAgent(pages[loadedPage] ?? '', agentSource, loadedPage),
    [pages, loadedPage, agentSource],
  );

  return (
    <div className="flex h-screen flex-col bg-neutral-100" data-testid="export-viewer">
      <header className="flex items-center gap-3 border-b border-neutral-200 bg-white px-3 py-2">
        <h1 className="truncate text-sm font-semibold">
          {meta.projectName} · v{meta.versionNumber}
        </h1>
        <span
          role="note"
          className="rounded bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700"
        >
          唯讀匯出檔 · 無網路
        </span>
      </header>
      <ExportToolbar
        device={ui.device}
        onDevice={ui.setDevice}
        fit={ui.fit}
        onFit={ui.setFit}
        scale={scale}
        showComments={ui.showComments}
        onShowComments={ui.setShowComments}
        showResolved={ui.showResolved}
        onShowResolved={ui.setShowResolved}
        panelOpen={ui.panelOpen}
        onPanelOpen={ui.setPanelOpen}
        threadCount={threads.length}
        pages={pageInfos}
        pageId={readyPage ?? loadedPage}
        onPage={reloadFrame}
      />
      <div className="flex min-h-0 flex-1">
        <div
          ref={setContainerEl}
          className="relative min-w-0 flex-1 overflow-auto p-4"
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
            <ThreadLayer
              threads={threads}
              actions={READ_ONLY_ACTIONS}
              createThread={rejectCreateThread}
              actor={READ_ONLY_ACTOR}
              pagePaths={pagePaths}
              currentPageId={readyPage}
              scale={scale}
              frameViewport={viewport}
              rects={rects}
              results={results}
              boundary={containerEl}
              onScrollTo={scrollTo}
            />
            <FrameWatchdog
              state={watchdog.state}
              onStop={watchdog.stop}
              onReload={() => reloadFrame(loadedPage)}
            />
          </div>
          {toast && (
            <div
              role="status"
              className="fixed bottom-4 left-1/2 z-50 max-w-md -translate-x-1/2 rounded-md bg-neutral-900 px-3 py-2 text-sm text-white shadow-lg"
            >
              {toast}
            </div>
          )}
        </div>
        {ui.panelOpen && (
          <CommentPanel
            items={items}
            filters={ui.filters}
            onFiltersChange={ui.setFilters}
            pages={pagePaths}
            currentWidth={width}
            openId={ui.openThreadId}
            onSelect={selectThread}
            actor={READ_ONLY_ACTOR}
            actions={READ_ONLY_ACTIONS}
            onClose={() => ui.setPanelOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
