import { DEVICE_PRESETS, type PageInfo } from '@hpe/shared';
import type { DeviceState } from '@web/state/uiStore';

export interface ExportToolbarProps {
  device: DeviceState;
  onDevice: (d: DeviceState) => void;
  fit: boolean;
  onFit: (v: boolean) => void;
  scale: number;
  showComments: boolean;
  onShowComments: (v: boolean) => void;
  showResolved: boolean;
  onShowResolved: (v: boolean) => void;
  panelOpen: boolean;
  onPanelOpen: (v: boolean) => void;
  threadCount: number;
  pages: readonly PageInfo[];
  pageId: string | null;
  onPage: (path: string) => void;
}

const btn = (active: boolean) =>
  `rounded-md border px-2 py-1 text-xs ${
    active
      ? 'border-blue-600 bg-blue-600 text-white'
      : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50'
  }`;

/** 唯讀版工具列：裝置尺寸、縮放、頁面、顯示控制、留言面板。沒有 Comment 模式。 */
export function ExportToolbar(p: ExportToolbarProps) {
  return (
    <div
      role="toolbar"
      aria-label="Viewer 工具列"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-neutral-200 bg-white px-3 py-2"
    >
      <div role="group" aria-label="裝置尺寸" className="flex items-center gap-1">
        {DEVICE_PRESETS.map((d) => (
          <button
            key={d.id}
            type="button"
            aria-pressed={p.device.presetId === d.id}
            className={btn(p.device.presetId === d.id)}
            onClick={() => p.onDevice({ presetId: d.id, width: d.width, height: d.height })}
          >
            {d.label}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={p.fit}
          className={btn(p.fit)}
          onClick={() => p.onFit(!p.fit)}
          title="縮放到符合畫面"
        >
          符合畫面{p.fit ? `（${Math.round(p.scale * 100)}%）` : ''}
        </button>
      </div>

      <label className="flex items-center gap-1 text-xs text-neutral-700">
        頁面
        <select
          aria-label="頁面"
          value={p.pageId ?? ''}
          onChange={(e) => p.onPage(e.target.value)}
          className="max-w-48 rounded-md border border-neutral-300 bg-white px-1.5 py-1 text-xs"
        >
          {p.pageId !== null && !p.pages.some((pg) => pg.path === p.pageId) && (
            <option value={p.pageId}>{p.pageId}</option>
          )}
          {p.pages.map((pg) => (
            <option key={pg.path} value={pg.path}>
              {pg.title ? `${pg.title}（${pg.path}）` : pg.path}
            </option>
          ))}
        </select>
      </label>

      <div role="group" aria-label="顯示" className="flex items-center gap-1">
        <button
          type="button"
          aria-pressed={p.showComments}
          title="顯示留言（Shift+C）"
          className={btn(p.showComments)}
          onClick={() => p.onShowComments(!p.showComments)}
        >
          顯示留言
        </button>
        <button
          type="button"
          aria-pressed={p.showResolved}
          className={btn(p.showResolved)}
          onClick={() => p.onShowResolved(!p.showResolved)}
        >
          顯示已解決
        </button>
        <button
          type="button"
          aria-pressed={p.panelOpen}
          aria-expanded={p.panelOpen}
          className={btn(p.panelOpen)}
          onClick={() => p.onPanelOpen(!p.panelOpen)}
        >
          留言面板（{p.threadCount}）
        </button>
      </div>
    </div>
  );
}
