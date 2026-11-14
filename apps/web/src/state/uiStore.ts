import { create } from 'zustand';
import {
  DEFAULT_THREAD_FILTERS,
  DEVICE_PRESETS,
  type Anchor,
  type Mode,
  type Rect,
  type ThreadFilters,
} from '@hpe/shared';

/** 草稿：使用者在 Comment 模式單擊後、尚未送出的 pin（不寫入 API）。 */
export interface Draft {
  anchor: Anchor;
  /** 建立當下 agent 回報的 viewport 座標 rect */
  rect: Rect;
}

export const DRAFT_ID = '__draft__';

export interface DeviceState {
  /** DEVICE_PRESETS 的 id，或 'custom' */
  presetId: string;
  width: number;
  height: number;
}

export const DEFAULT_DEVICE: DeviceState = {
  presetId: DEVICE_PRESETS[0].id,
  width: DEVICE_PRESETS[0].width,
  height: DEVICE_PRESETS[0].height,
};

const TOOLBAR_COLLAPSED_KEY = 'hpe.viewer.toolbarCollapsed';

function readToolbarCollapsed(): boolean {
  try {
    return localStorage.getItem(TOOLBAR_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

export interface UiState {
  mode: Mode;
  showComments: boolean;
  showResolved: boolean;
  panelOpen: boolean;
  openThreadId: string | null;
  draft: Draft | null;
  filters: ThreadFilters;
  device: DeviceState;
  /** 縮放到符合畫面 */
  fit: boolean;
  /** viewer 工具列收合；偏好存在 localStorage，跨 viewer 保留 */
  toolbarCollapsed: boolean;
  /** agent 回報的目前頁面（bundle 路徑） */
  pageId: string | null;

  setMode(mode: Mode): void;
  toggleMode(): void;
  setShowComments(v: boolean): void;
  toggleShowComments(): void;
  setShowResolved(v: boolean): void;
  setPanelOpen(v: boolean): void;
  /** 開啟某張卡片（同時最多一張；會捨棄草稿）。null = 關閉。 */
  openThread(id: string | null): void;
  /** 建立／取代草稿（會關閉已開啟的卡片）。 */
  setDraft(draft: Draft): void;
  clearDraft(): void;
  setFilters(patch: Partial<ThreadFilters>): void;
  setDevice(device: DeviceState): void;
  setFit(v: boolean): void;
  setToolbarCollapsed(v: boolean): void;
  setPageId(id: string | null): void;
  reset(): void;
}

const initial = {
  mode: 'interact' as Mode,
  showComments: true,
  showResolved: false,
  panelOpen: false,
  openThreadId: null as string | null,
  draft: null as Draft | null,
  filters: DEFAULT_THREAD_FILTERS,
  device: DEFAULT_DEVICE,
  fit: true,
  pageId: null as string | null,
};

export const useUiStore = create<UiState>()((set) => ({
  ...initial,
  toolbarCollapsed: readToolbarCollapsed(),
  setMode: (mode) => set(mode === 'interact' ? { mode, draft: null } : { mode }),
  toggleMode: () =>
    set((s) => (s.mode === 'comment' ? { mode: 'interact', draft: null } : { mode: 'comment' })),
  setShowComments: (showComments) =>
    set(showComments ? { showComments } : { showComments, openThreadId: null, draft: null }),
  toggleShowComments: () =>
    set((s) =>
      s.showComments
        ? { showComments: false, openThreadId: null, draft: null }
        : { showComments: true },
    ),
  setShowResolved: (showResolved) => set({ showResolved }),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  openThread: (id) => set({ openThreadId: id, draft: null }),
  setDraft: (draft) => set({ draft, openThreadId: null }),
  clearDraft: () => set({ draft: null }),
  setFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
  setDevice: (device) => set({ device }),
  setFit: (fit) => set({ fit }),
  setToolbarCollapsed: (toolbarCollapsed) => {
    try {
      localStorage.setItem(TOOLBAR_COLLAPSED_KEY, toolbarCollapsed ? '1' : '0');
    } catch {
      /* 儲存失敗只影響下次載入，不影響這次狀態 */
    }
    set({ toolbarCollapsed });
  },
  setPageId: (pageId) => set({ pageId }),
  reset: () => set((s) => ({ ...initial, toolbarCollapsed: s.toolbarCollapsed })),
}));
