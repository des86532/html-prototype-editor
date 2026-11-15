import { create } from 'zustand';
import {
  DEVICE_PRESETS,
  MARKUP_COLORS,
  type MarkupColor,
  type MarkupStroke,
  type MarkupTool,
} from '@hpe/shared';

/** interact：操作 prototype；markup：在 prototype 上畫標記。 */
export type ViewerMode = 'interact' | 'markup';

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
  mode: ViewerMode;
  tool: MarkupTool | 'select';
  color: MarkupColor;
  stroke: MarkupStroke;
  showMarkups: boolean;
  showResolved: boolean;
  panelOpen: boolean;
  /** 目前選取（開啟卡片）的標記 id */
  selectedId: string | null;
  device: DeviceState;
  /** 縮放到符合畫面 */
  fit: boolean;
  /** viewer 工具列收合；偏好存在 localStorage，跨 viewer 保留 */
  toolbarCollapsed: boolean;
  /** agent 回報的目前頁面（bundle 路徑） */
  pageId: string | null;

  setMode(mode: ViewerMode): void;
  toggleMode(): void;
  setTool(tool: MarkupTool | 'select'): void;
  setColor(color: MarkupColor): void;
  setStroke(stroke: MarkupStroke): void;
  /** 選取標記（同時最多一個）。null = 取消選取。 */
  select(id: string | null): void;
  setShowMarkups(v: boolean): void;
  toggleShowMarkups(): void;
  setShowResolved(v: boolean): void;
  setPanelOpen(v: boolean): void;
  setDevice(device: DeviceState): void;
  setFit(v: boolean): void;
  setToolbarCollapsed(v: boolean): void;
  setPageId(id: string | null): void;
  reset(): void;
}

const initial = {
  mode: 'interact' as ViewerMode,
  tool: 'rect' as MarkupTool | 'select',
  color: MARKUP_COLORS[0] as MarkupColor,
  stroke: 4 as MarkupStroke,
  showMarkups: true,
  showResolved: false,
  panelOpen: false,
  selectedId: null as string | null,
  device: DEFAULT_DEVICE,
  fit: true,
  pageId: null as string | null,
};

const HIDDEN = { showMarkups: false, mode: 'interact' as ViewerMode, selectedId: null };

export const useUiStore = create<UiState>()((set) => ({
  ...initial,
  toolbarCollapsed: readToolbarCollapsed(),
  setMode: (mode) => set({ mode }),
  toggleMode: () => set((s) => ({ mode: s.mode === 'markup' ? 'interact' : 'markup' })),
  setTool: (tool) => set({ tool }),
  setColor: (color) => set({ color }),
  setStroke: (stroke) => set({ stroke }),
  select: (selectedId) => set({ selectedId }),
  setShowMarkups: (showMarkups) => set(showMarkups ? { showMarkups } : HIDDEN),
  toggleShowMarkups: () => set((s) => (s.showMarkups ? HIDDEN : { showMarkups: true })),
  setShowResolved: (showResolved) => set({ showResolved }),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
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
