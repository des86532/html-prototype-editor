import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  DEVICE_PRESETS,
  FRAME_TIMINGS,
  MESSAGE_LIMITS,
  PROTOCOL_VERSION,
  type Anchor,
  type FrameToParent,
  type PrototypeVersion,
  type Rect,
  type Thread,
} from '@hpe/shared';
import type { Api } from '@/lib/api';
import { messageForError } from '@/lib/errorMessages';
import { truncate } from '@/lib/format';
import { useLatest } from '@/lib/useLatest';
import { CommentPanel, type PanelThread } from '@/features/comments/CommentPanel';
import { canComment, type ThreadActor } from '@/features/comments/permissions';
import { useViewerShortcuts } from '@/features/comments/shortcuts';
import { useThreads } from '@/features/comments/useThreads';
import { DRAFT_ID, useUiStore, type Draft } from '@/state/uiStore';
import { DeviceToolbar } from './DeviceToolbar';
import { FrameWatchdog, useFrameWatchdog } from './FrameWatchdog';
import { HoverHighlight } from './HoverHighlight';
import { SandboxFrame } from './SandboxFrame';
import { ThreadLayer } from './ThreadLayer';
import { effectiveAnchorStatus, type AnchorResult } from './buildPins';
import { frameSrc } from './frameSrc';
import { useFrameBridge, type BridgeWarning } from './useFrameBridge';

export interface PrototypeViewerProps {
  version: PrototypeVersion;
  projectName?: string;
  actor: ThreadActor;
  /** 複製連結用的 URL */
  buildThreadUrl: (thread: Thread) => string;
  /** 擁有者才傳：開啟 ExportDialog */
  onExport?: () => void;
  /** 進入時自動開啟的討論串（`?thread=`） */
  initialThreadId?: string | null;
  /** header 左側的額外內容（返回連結、分享按鈕…） */
  headerExtra?: ReactNode;
  api?: Api;
  /** 測試用：覆寫 iframe src */
  srcOverride?: string;
}

const FIT_PADDING_PX = 32;
const TOAST_MS = 4000;

function useElementWidth(el: HTMLElement | null): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el) return;
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return width;
}

/** 單一 viewer：header（不受信任內容）、工具列、sandbox frame + overlay、留言面板。 */
export function PrototypeViewer({
  version,
  projectName,
  actor,
  buildThreadUrl,
  onExport,
  initialThreadId = null,
  headerExtra,
  api,
  srcOverride,
}: PrototypeViewerProps) {
  const ui = useUiStore();
  const writable = canComment(actor);
  const mode = writable ? ui.mode : 'interact';

  const pagePaths = useMemo(() => version.pages.map((p) => p.path), [version.pages]);
  const [loadedPage, setLoadedPage] = useState(version.entryPage);
  const [frameKey, setFrameKey] = useState(0);
  const [iframe, setIframe] = useState<HTMLIFrameElement | null>(null);
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const containerWidth = useElementWidth(containerEl);

  // 每個 viewer 重置 UI 狀態（模式、草稿、卡片、篩選）。
  useEffect(() => {
    useUiStore.getState().reset();
    useUiStore.getState().setPageId(version.entryPage);
    return () => useUiStore.getState().reset();
  }, [version.id, version.entryPage]);

  const { threads, createThread, actions } = useThreads(version.id, {
    api,
    me: actor.me,
    buildThreadUrl,
  });
  const wrappedCreate = useCallback(
    (anchor: Anchor, body: string) => createThread(anchor, body),
    [createThread],
  );

  /* ---------------- frame 狀態 ---------------- */
  const [readyPage, setReadyPage] = useState<string | null>(null);
  const [readyEpoch, setReadyEpoch] = useState(0);
  const [rects, setRects] = useState<Record<string, Rect | null>>({});
  const [results, setResults] = useState<Record<string, AnchorResult>>({});
  const [frameViewport, setFrameViewport] = useState<{ w: number; h: number } | null>(null);
  const [hover, setHover] = useState<{ rect: Rect | null; label: string }>({
    rect: null,
    label: '',
  });
  const [draftRect, setDraftRect] = useState<{ draft: Draft; rect: Rect | null } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const storageRef = useRef<string | undefined>(undefined);
  const resolvedRef = useRef<Set<string>>(new Set());
  const lastDraftRef = useRef<Draft | null>(null);
  const requestSeq = useRef(0);
  const pendingOpenRef = useRef<string | null>(initialThreadId);
  const lastToastAt = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftLatest = useLatest<Draft | null>(ui.draft);
  const modeRef = useLatest(mode);
  const writableRef = useLatest(writable);
  const deviceRef = useLatest(ui.device);

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

  const onMessage = useCallback(
    (msg: FrameToParent) => {
      watchdogHandleRef.current(msg);
      const send = sendRef.current;
      switch (msg.type) {
        case 'ready': {
          resolvedRef.current = new Set();
          lastDraftRef.current = null;
          setRects({});
          setResults({});
          setDraftRect(null);
          setHover({ rect: null, label: '' });
          setReadyPage(msg.pageId);
          setReadyEpoch((n) => n + 1);
          useUiStore.getState().setPageId(msg.pageId);
          send({
            v: PROTOCOL_VERSION,
            type: 'init',
            mode: modeRef.current,
            ...(storageRef.current !== undefined ? { storageSeed: storageRef.current } : {}),
          });
          break;
        }
        case 'hover':
          setHover({ rect: msg.rect, label: msg.label });
          break;
        case 'pick': {
          if (!writableRef.current || modeRef.current !== 'comment') break;
          const dev = deviceRef.current;
          const anchor: Anchor = {
            ...msg.draft,
            viewport: {
              ...msg.draft.viewport,
              ...(dev.presetId !== 'custom' ? { preset: dev.presetId } : {}),
            },
          };
          const s = useUiStore.getState();
          if (!s.showComments) s.setShowComments(true);
          s.setDraft({ anchor, rect: msg.rect });
          setHover({ rect: null, label: '' });
          break;
        }
        case 'anchorsResolved': {
          setResults((prev) => {
            const next = { ...prev };
            for (const r of msg.results) {
              if (r.threadId !== DRAFT_ID)
                next[r.threadId] = { status: r.status, confidence: r.confidence };
            }
            return next;
          });
          setRects((prev) => {
            const next = { ...prev };
            for (const r of msg.results) if (r.threadId !== DRAFT_ID) next[r.threadId] = r.rect;
            return next;
          });
          const d = msg.results.find((r) => r.threadId === DRAFT_ID);
          if (d && draftLatest.current) setDraftRect({ draft: draftLatest.current, rect: d.rect });
          break;
        }
        case 'geometry': {
          setFrameViewport(msg.viewport);
          setRects((prev) => ({ ...prev, ...msg.rects }));
          if (DRAFT_ID in msg.rects && draftLatest.current) {
            setDraftRect({ draft: draftLatest.current, rect: msg.rects[DRAFT_ID] ?? null });
          }
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
        case 'storageSnapshot':
          storageRef.current = msg.data;
          break;
        default:
          // pong（watchdog 已處理）、navigateRequest（live viewer 忽略）、described（P1）
          break;
      }
    },
    [showToast, deviceRef, draftLatest, modeRef, writableRef],
  );

  const onDropped = useCallback((reason: BridgeWarning) => {
    if (reason === 'rate-limited') setWarning('prototype 傳送訊息過於頻繁，已暫停處理。');
    else if (reason === 'too-large') setWarning('已丟棄一則過大的 prototype 訊息。');
  }, []);

  const { send } = useFrameBridge({ iframe, onMessage, onDropped });
  const watchdog = useFrameWatchdog({ iframe, send });
  useLayoutEffect(() => {
    sendRef.current = send;
    watchdogHandleRef.current = watchdog.handleMessage;
  });

  useEffect(() => {
    if (!warning) return;
    const t = setTimeout(() => setWarning(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [warning]);

  /* ---------------- 模式同步 ---------------- */
  useEffect(() => {
    if (readyEpoch === 0) return;
    send({ v: PROTOCOL_VERSION, type: 'setMode', mode });
  }, [mode, readyEpoch, send]);

  /* ---------------- resolve + track ---------------- */
  const pageThreads = useMemo(
    () => threads.filter((t) => readyPage !== null && t.anchor.pageId === readyPage),
    [threads, readyPage],
  );
  const pageIdsKey = pageThreads.map((t) => t.id).join(',');
  useEffect(() => {
    if (readyEpoch === 0 || readyPage === null) return;
    const todo: { threadId: string; anchor: Anchor }[] = [];
    for (const t of pageThreads) {
      if (!resolvedRef.current.has(t.id)) {
        resolvedRef.current.add(t.id);
        todo.push({ threadId: t.id, anchor: t.anchor });
      }
    }
    const draft = ui.draft;
    if (draft && lastDraftRef.current !== draft) {
      todo.push({ threadId: DRAFT_ID, anchor: draft.anchor });
    }
    lastDraftRef.current = draft;
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
      threadIds: [...pageThreads.map((t) => t.id), ...(draft ? [DRAFT_ID] : [])].slice(
        0,
        MESSAGE_LIMITS.maxAnchorsPerRequest,
      ),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pageIdsKey 代表 pageThreads 的 id 集合
  }, [readyEpoch, readyPage, pageIdsKey, ui.draft, send]);

  const layerRects = useMemo(() => {
    const out: Record<string, Rect | null | undefined> = { ...rects };
    out[DRAFT_ID] = draftRect && draftRect.draft === ui.draft ? draftRect.rect : undefined;
    return out;
  }, [rects, draftRect, ui.draft]);

  const onDraftPromoted = useCallback(
    (threadId: string) => {
      const r = draftRect?.rect ?? null;
      setRects((prev) => ({ ...prev, [threadId]: r }));
      setResults((prev) => ({ ...prev, [threadId]: { status: 'exact', confidence: 1 } }));
    },
    [draftRect],
  );

  const scrollTo = useCallback(
    (threadId: string) => {
      send({ v: PROTOCOL_VERSION, type: 'scrollToAnchor', threadId });
    },
    [send],
  );

  /* ---------------- 頁面 / 寬度 ---------------- */
  const reloadFrame = useCallback(
    (page: string) => {
      setLoadedPage(page);
      setFrameKey((k) => k + 1);
      watchdog.reset();
      setReadyPage(null);
      setReadyEpoch(0);
      setRects({});
      setResults({});
    },
    [watchdog],
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

  // 等頁面切換完成、錨點解析後才開啟卡片（面板選取、`?thread=` 進入）。
  useEffect(() => {
    const id = pendingOpenRef.current;
    if (!id) return;
    const t = threads.find((x) => x.id === id);
    if (!t) return;
    if (readyPage === null) return;
    if (t.anchor.pageId !== readyPage) {
      // 目前頁面不是目標頁面（`?thread=` 進入）：切換過去。
      pendingOpenRef.current = id;
      reloadFrame(t.anchor.pageId);
      return;
    }
    if (results[id] === undefined) return;
    pendingOpenRef.current = null;
    scrollTo(id);
    useUiStore.getState().openThread(id);
  }, [threads, readyPage, results, scrollTo, reloadFrame]);

  const items = useMemo<PanelThread[]>(
    () =>
      threads.map((thread) => ({
        thread,
        anchorStatus: effectiveAnchorStatus(thread, results, pagePaths, readyPage),
      })),
    [threads, results, pagePaths, readyPage],
  );

  /* ---------------- 快捷鍵 ---------------- */
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
    const s = useUiStore.getState();
    const id = s.openThreadId;
    if (s.draft) s.clearDraft();
    else s.openThread(null);
    if (id) {
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>(`[data-pin-id="${CSS.escape(id)}"] button`)?.focus(),
      );
    }
  }, []);
  useViewerShortcuts({
    canComment: writable,
    navigableIds,
    openId: ui.openThreadId,
    hasDraft: ui.draft !== null,
    toggleMode: () => useUiStore.getState().toggleMode(),
    toggleShowComments: () => useUiStore.getState().toggleShowComments(),
    escape: closeCard,
    openThread: (id) => {
      useUiStore.getState().openThread(id);
      scrollTo(id);
    },
    toggleResolveOpen: () => {
      const t = threads.find((x) => x.id === ui.openThreadId);
      if (!t) return;
      void Promise.resolve(actions.onSetStatus(t, t.status === 'open' ? 'resolved' : 'open')).catch(
        (e: unknown) => showToast(e instanceof Error ? e.message : messageForError(e)),
      );
    },
  });

  /* ---------------- 版面 ---------------- */
  const { width, height } = ui.device;
  const scale =
    ui.fit && containerWidth > 0 ? Math.min(1, (containerWidth - FIT_PADDING_PX) / width) : 1;
  const viewport = frameViewport ?? { w: width, h: height };
  const src = srcOverride ?? frameSrc(version.contentKey, loadedPage);

  return (
    <div className="flex h-screen flex-col bg-neutral-100" data-testid="prototype-viewer">
      <header className="flex items-center gap-3 border-b border-neutral-200 bg-white px-3 py-2">
        {headerExtra}
        <h1 className="truncate text-sm font-semibold">
          {projectName ? `${projectName} · ` : ''}v{version.number}
        </h1>
        <span
          role="note"
          className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900"
        >
          不受信任內容
        </span>
      </header>
      <DeviceToolbar
        device={ui.device}
        onDevice={ui.setDevice}
        fit={ui.fit}
        onFit={ui.setFit}
        scale={scale}
        mode={mode}
        onMode={ui.setMode}
        canComment={writable}
        showComments={ui.showComments}
        onShowComments={ui.setShowComments}
        showResolved={ui.showResolved}
        onShowResolved={ui.setShowResolved}
        panelOpen={ui.panelOpen}
        onPanelOpen={ui.setPanelOpen}
        threadCount={threads.length}
        pages={version.pages}
        pageId={readyPage ?? loadedPage}
        onPage={reloadFrame}
        onExport={onExport}
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
            <SandboxFrame
              key={frameKey}
              ref={setIframe}
              src={src}
              width={width}
              height={height}
              scale={scale}
            />
            {mode === 'comment' && (
              <HoverHighlight rect={hover.rect} label={hover.label} scale={scale} />
            )}
            <ThreadLayer
              threads={threads}
              actions={actions}
              createThread={wrappedCreate}
              actor={actor}
              pagePaths={pagePaths}
              currentPageId={readyPage}
              scale={scale}
              frameViewport={viewport}
              rects={layerRects}
              results={results}
              boundary={containerEl}
              onScrollTo={scrollTo}
              onDraftPromoted={onDraftPromoted}
            />
            <FrameWatchdog
              state={watchdog.state}
              onStop={watchdog.stop}
              onReload={() => reloadFrame(loadedPage)}
            />
          </div>
          {(toast || warning) && (
            <div
              role="status"
              className="fixed bottom-4 left-1/2 z-50 max-w-md -translate-x-1/2 rounded-md bg-neutral-900 px-3 py-2 text-sm text-white shadow-lg"
            >
              {toast ?? warning}
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
            actor={actor}
            actions={actions}
            onClose={() => ui.setPanelOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
