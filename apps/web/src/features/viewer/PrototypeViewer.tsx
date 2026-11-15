import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  DEVICE_PRESETS,
  FRAME_TIMINGS,
  MESSAGE_LIMITS,
  PROTOCOL_VERSION,
  shapeBounds,
  type FrameToParent,
  type Markup,
  type MarkupShape,
  type PrototypeVersion,
  type Thread,
} from '@hpe/shared';
import type { Api } from '@/lib/api';
import { messageForError } from '@/lib/errorMessages';
import { truncate } from '@/lib/format';
import { useElementSize } from '@/lib/useElementSize';
import { useLatest } from '@/lib/useLatest';
import { canComment, canManageMarkup, type ThreadActor } from '@/features/comments/permissions';
import { ThreadPopover } from '@/features/comments/ThreadPopover';
import { useViewerShortcuts } from '@/features/comments/shortcuts';
import { threadsKey, useThreads } from '@/features/comments/useThreads';
import { MarkupCanvas } from '@/features/markup/MarkupCanvas';
import { MarkupPanel } from '@/features/markup/MarkupPanel';
import { MarkupTools } from '@/features/markup/MarkupTools';
import { WidthChips } from '@/features/markup/WidthChips';
import { useMarkupHistory } from '@/features/markup/useMarkupHistory';
import { CropMarks } from '@/features/ui/CropMarks';
import { useUiStore, type DeviceState } from '@/state/uiStore';
import { DeviceToolbar } from './DeviceToolbar';
import { FrameWatchdog, useFrameWatchdog } from './FrameWatchdog';
import { SandboxFrame } from './SandboxFrame';
import { fitScale } from './fitScale';
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
  /** 進入時自動選取的標記（`?thread=`） */
  initialThreadId?: string | null;
  /** header 左側的額外內容（返回連結、分享按鈕…） */
  headerExtra?: ReactNode;
  api?: Api;
  /** 測試用：覆寫 iframe src */
  srcOverride?: string;
}

const TOAST_MS = 4000;

interface FrameScroll {
  x: number;
  y: number;
  vw: number;
  vh: number;
}

function deviceFor(width: number, height: number): DeviceState {
  const preset = DEVICE_PRESETS.find((p) => p.width === width);
  return preset
    ? { presetId: preset.id, width: preset.width, height: preset.height }
    : { presetId: 'custom', width, height };
}

/** 單一 viewer：header（不受信任內容）、工具列、sandbox frame + 標記 overlay、標記面板。 */
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
  const [canvasEl, setCanvasEl] = useState<HTMLElement | null>(null);
  const [selectedAnchorEl, setSelectedAnchorEl] = useState<HTMLElement | null>(null);
  const containerSize = useElementSize(containerEl);
  const toolbarId = useId();
  const qc = useQueryClient();

  // 每個 viewer 重置 UI 狀態（模式、工具、選取）。
  useEffect(() => {
    useUiStore.getState().reset();
    useUiStore.getState().setPageId(version.entryPage);
    return () => useUiStore.getState().reset();
  }, [version.id, version.entryPage]);

  const { threads, createMarkup, actions } = useThreads(version.id, {
    api,
    me: actor.me,
    buildThreadUrl,
  });
  const history = useMarkupHistory(version.id);
  const threadsRef = useLatest(threads);

  /* ---------------- frame 狀態 ---------------- */
  const [readyPage, setReadyPage] = useState<string | null>(null);
  const [scroll, setScroll] = useState<FrameScroll | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const storageRef = useRef<string | undefined>(undefined);
  const pendingSelectRef = useRef<string | null>(initialThreadId);
  const lastToastAt = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  const toastError = useCallback(
    (e: unknown) => showToast(e instanceof Error ? e.message : messageForError(e)),
    [showToast],
  );

  const sendRef = useRef<ReturnType<typeof useFrameBridge>['send']>(() => false);
  const watchdogHandleRef = useRef<(m: FrameToParent) => void>(() => undefined);

  const onMessage = useCallback(
    (msg: FrameToParent) => {
      watchdogHandleRef.current(msg);
      const send = sendRef.current;
      switch (msg.type) {
        case 'ready': {
          setReadyPage(msg.pageId);
          useUiStore.getState().setPageId(msg.pageId);
          send({
            v: PROTOCOL_VERSION,
            type: 'init',
            ...(storageRef.current !== undefined ? { storageSeed: storageRef.current } : {}),
          });
          break;
        }
        case 'scroll':
          setScroll({ x: msg.x, y: msg.y, vw: msg.vw, vh: msg.vh });
          break;
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
          // pong（watchdog 已處理）、navigateRequest（live viewer 忽略）
          break;
      }
    },
    [showToast],
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

  /* ---------------- 頁面 / 寬度 ---------------- */
  const reloadFrame = useCallback(
    (page: string) => {
      setLoadedPage(page);
      setFrameKey((k) => k + 1);
      watchdog.reset();
      setReadyPage(null);
      setScroll(null);
    },
    [watchdog],
  );

  const { width, height } = ui.device;

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

  const applyWidth = useCallback((w: number, h: number) => {
    const s = useUiStore.getState();
    if (w !== s.device.width) s.setDevice(deviceFor(w, h));
  }, []);

  /** 同頁：切寬度、捲到標記中央並選取。 */
  const focusThread = useCallback(
    (t: Thread) => {
      const s = useUiStore.getState();
      if (!s.showMarkups) s.setShowMarkups(true);
      applyWidth(t.markup.viewport.width, t.markup.viewport.height);
      const b = shapeBounds(t.markup.shape);
      const vw = scroll?.vw ?? t.markup.viewport.width;
      const vh = scroll?.vh ?? t.markup.viewport.height;
      send({
        v: PROTOCOL_VERSION,
        type: 'scrollTo',
        x: Math.max(0, b.x + b.w / 2 - vw / 2),
        y: Math.max(0, b.y + b.h / 2 - vh / 2),
      });
      s.select(t.id);
    },
    [applyWidth, scroll, send],
  );

  const jumpTo = useCallback(
    (t: Thread) => {
      applyWidth(t.markup.viewport.width, t.markup.viewport.height);
      if (t.markup.pageId !== readyPage) {
        pendingSelectRef.current = t.id;
        reloadFrame(t.markup.pageId);
      } else {
        focusThread(t);
      }
    },
    [applyWidth, focusThread, readyPage, reloadFrame],
  );

  // 等頁面切換完成、agent 可以捲動後才選取（面板選取、`?thread=` 進入）。
  useEffect(() => {
    const id = pendingSelectRef.current;
    if (!id) return;
    const t = threads.find((x) => x.id === id);
    if (!t || readyPage === null) return;
    if (t.markup.pageId !== readyPage) {
      reloadFrame(t.markup.pageId);
      return;
    }
    if (scroll === null) return;
    pendingSelectRef.current = null;
    focusThread(t);
  }, [threads, readyPage, scroll, reloadFrame, focusThread]);

  /* ---------------- 標記操作 ---------------- */
  const canManage = useCallback((t: Thread) => canManageMarkup(actor, t), [actor]);

  const onCreate = useCallback(
    (shape: MarkupShape) => {
      if (readyPage === null) return;
      const markup: Markup = {
        pageId: readyPage,
        viewport: { width: ui.device.width, height: ui.device.height },
        shape,
      };
      const key = threadsKey(version.id);
      const before = new Set((qc.getQueryData<Thread[]>(key) ?? []).map((t) => t.id));
      const promise = createMarkup(markup);
      const tmpId =
        (qc.getQueryData<Thread[]>(key) ?? []).find(
          (t) => t.id.startsWith('tmp-') && !before.has(t.id),
        )?.id ?? null;
      const autoSelect = shape.kind === 'rect' || shape.kind === 'arrow';
      if (tmpId) {
        history.push({ kind: 'create', threadId: tmpId });
        if (autoSelect) useUiStore.getState().select(tmpId);
      }
      promise.then(
        (t) => {
          const s = useUiStore.getState();
          if (tmpId) {
            history.replaceId(tmpId, t.id);
            if (s.selectedId === tmpId) s.select(t.id);
          } else {
            history.push({ kind: 'create', threadId: t.id });
            if (autoSelect) s.select(t.id);
          }
        },
        (e: unknown) => {
          const s = useUiStore.getState();
          if (tmpId && s.selectedId === tmpId) s.select(null);
          toastError(e);
        },
      );
    },
    [
      readyPage,
      ui.device.width,
      ui.device.height,
      version.id,
      qc,
      createMarkup,
      history,
      toastError,
    ],
  );

  const onMove = useCallback(
    (t: Thread, shape: MarkupShape) => {
      history.push({ kind: 'move', threadId: t.id, before: t.markup.shape });
      void Promise.resolve(actions.onMoveMarkup(t, shape)).catch(toastError);
    },
    [actions, history, toastError],
  );

  const deleteMarkup = useCallback(
    (t: Thread) => {
      if (!canManageMarkup(actor, t)) return;
      if (t.comments.length === 0) history.push({ kind: 'delete', markup: t.markup });
      void Promise.resolve(actions.onDeleteThread(t)).catch(toastError);
      useUiStore.getState().select(null);
    },
    [actor, actions, history, toastError],
  );

  const deleteSelected = useCallback(() => {
    const id = useUiStore.getState().selectedId;
    const t = threadsRef.current.find((x) => x.id === id);
    if (!t || !canManageMarkup(actor, t)) return;
    if (t.comments.length > 0) {
      showToast('有留言的標記請從卡片刪除');
      return;
    }
    deleteMarkup(t);
  }, [actor, deleteMarkup, showToast, threadsRef]);

  const undo = useCallback(() => {
    for (;;) {
      const e = history.undo();
      if (!e) return;
      if (e.kind === 'delete') {
        createMarkup(e.markup).catch(toastError);
        return;
      }
      const t = threadsRef.current.find((x) => x.id === e.threadId);
      if (!t) continue;
      if (e.kind === 'create') {
        void Promise.resolve(actions.onDeleteThread(t)).catch(toastError);
        const s = useUiStore.getState();
        if (s.selectedId === t.id) s.select(null);
      } else {
        void Promise.resolve(actions.onMoveMarkup(t, e.before)).catch(toastError);
      }
      return;
    }
  }, [actions, createMarkup, history, threadsRef, toastError]);

  const onScrollBy = useCallback(
    (dx: number, dy: number) => {
      send({ v: PROTOCOL_VERSION, type: 'scrollBy', dx, dy });
    },
    [send],
  );

  /* ---------------- 快捷鍵 ---------------- */
  const focusBadge = useCallback((id: string) => {
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(`[data-markup-id="${CSS.escape(id)}"]`)?.focus(),
    );
  }, []);

  const navigableIds = useMemo(
    () =>
      visible
        .filter((t) => t.number !== null)
        .sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
        .map((t) => t.id),
    [visible],
  );

  useViewerShortcuts({
    canMarkup: writable,
    mode,
    navigableIds,
    selectedId: ui.selectedId,
    toggleMode: () => useUiStore.getState().toggleMode(),
    toggleShowMarkups: () => useUiStore.getState().toggleShowMarkups(),
    escape: () => {
      const s = useUiStore.getState();
      if (s.selectedId !== null) {
        const id = s.selectedId;
        s.select(null);
        focusBadge(id);
        return true;
      }
      if (writable && s.mode === 'markup') {
        s.setMode('interact');
        return true;
      }
      return false;
    },
    select: (id) => {
      const t = threadsRef.current.find((x) => x.id === id);
      if (t) focusThread(t);
    },
    setTool: (tool) => useUiStore.getState().setTool(tool),
    deleteSelected,
    undo,
  });

  /* ---------------- popover ---------------- */
  const selected = ui.selectedId ? visible.find((t) => t.id === ui.selectedId) : undefined;
  const outOfView = useMemo(() => {
    if (!selected) return false;
    const b = shapeBounds(selected.markup.shape);
    const sx = scroll?.x ?? 0;
    const sy = scroll?.y ?? 0;
    const vw = scroll?.vw ?? width;
    const vh = scroll?.vh ?? height;
    return b.x + b.w < sx || b.x > sx + vw || b.y + b.h < sy || b.y > sy + vh;
  }, [selected, scroll, width, height]);

  /* ---------------- 版面 ---------------- */
  const scale = ui.fit ? fitScale(containerSize, ui.device) : 1;
  const src = srcOverride ?? frameSrc(version.contentKey, loadedPage);
  const markupCount = threads.filter((t) => t.number !== null).length;

  return (
    <div className="flex h-dvh flex-col bg-stage" data-testid="prototype-viewer">
      <header className="flex h-12 items-center gap-3 border-b border-line bg-surface px-3">
        {headerExtra}
        <h1 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
          {projectName && <span className="truncate">{projectName}</span>}
          <span className="rounded border border-line px-1.5 font-mono text-xs font-medium text-ink-2">
            v{version.number}
          </span>
        </h1>
        <span role="note" className="chip chip-warn">
          不受信任內容
        </span>
        <div className="ml-auto flex items-center gap-2">
          {ui.toolbarCollapsed && mode === 'markup' && (
            <span className="chip chip-accent">標記模式（C）</span>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-expanded={!ui.toolbarCollapsed}
            aria-controls={toolbarId}
            onClick={() => ui.setToolbarCollapsed(!ui.toolbarCollapsed)}
          >
            <span aria-hidden="true">{ui.toolbarCollapsed ? '▾' : '▴'}</span>
            {ui.toolbarCollapsed ? ' 展開工具列' : ' 收合工具列'}
          </button>
        </div>
      </header>
      {!ui.toolbarCollapsed && (
        <DeviceToolbar
          id={toolbarId}
          device={ui.device}
          onDevice={ui.setDevice}
          fit={ui.fit}
          onFit={ui.setFit}
          scale={scale}
          mode={mode}
          onMode={ui.setMode}
          canMarkup={writable}
          showMarkups={ui.showMarkups}
          onShowMarkups={ui.setShowMarkups}
          showResolved={ui.showResolved}
          onShowResolved={ui.setShowResolved}
          panelOpen={ui.panelOpen}
          onPanelOpen={ui.setPanelOpen}
          markupCount={markupCount}
          pages={version.pages}
          pageId={readyPage ?? loadedPage}
          onPage={reloadFrame}
          onExport={onExport}
        />
      )}
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <div
            ref={setContainerEl}
            className="stage-grid absolute inset-0 overflow-auto p-8"
            data-testid="viewer-container"
          >
            <div
              className="relative mx-auto"
              style={{ width: width * scale, height: height * scale }}
            >
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -top-7 left-0 font-mono text-[11px] whitespace-nowrap text-measure"
              >
                {width} × {height} · {Math.round(scale * 100)}%
              </div>
              <CropMarks />
              <SandboxFrame
                key={frameKey}
                ref={setIframe}
                src={src}
                width={width}
                height={height}
                scale={scale}
              />
              <MarkupCanvas
                threads={visible}
                scroll={{ x: scroll?.x ?? 0, y: scroll?.y ?? 0 }}
                frameSize={{ w: width, h: height }}
                scale={scale}
                mode={mode}
                tool={ui.tool}
                color={ui.color}
                stroke={ui.stroke}
                selectedId={ui.selectedId}
                canManage={canManage}
                onSelect={ui.select}
                onCreate={onCreate}
                onMove={onMove}
                onScrollBy={onScrollBy}
                onSelectedAnchor={setSelectedAnchorEl}
                onRootEl={setCanvasEl}
              />
              {selected && (
                <ThreadPopover
                  thread={selected}
                  referenceEl={selectedAnchorEl}
                  boundary={containerEl}
                  hidden={outOfView}
                  actor={actor}
                  actions={actions}
                  canDelete={canManage(selected)}
                  onDeleteMarkup={() => deleteMarkup(selected)}
                  ignoreOutside={canvasEl}
                  onClose={(reason) => {
                    const id = selected.id;
                    useUiStore.getState().select(null);
                    if (reason === 'escape') focusBadge(id);
                  }}
                />
              )}
              <FrameWatchdog
                state={watchdog.state}
                onStop={watchdog.stop}
                onReload={() => reloadFrame(loadedPage)}
              />
            </div>
            {(toast || warning) && (
              <div
                role="status"
                className="fixed bottom-4 left-1/2 z-50 max-w-md -translate-x-1/2 rounded-md bg-ink px-3 py-2 text-sm text-white shadow-lg"
              >
                {toast ?? warning}
              </div>
            )}
          </div>
          {mode === 'markup' && (
            <MarkupTools
              tool={ui.tool}
              onTool={ui.setTool}
              color={ui.color}
              onColor={ui.setColor}
              stroke={ui.stroke}
              onStroke={ui.setStroke}
              canUndo={history.canUndo}
              onUndo={undo}
            />
          )}
          <WidthChips
            threads={threads}
            pageId={readyPage}
            width={width}
            showResolved={ui.showResolved}
            onPick={applyWidth}
          />
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
