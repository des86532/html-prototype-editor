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

/** 唯讀版工具列：裝置尺寸、縮放、頁面、顯示控制、留言面板。沒有 Comment 模式。 */
export function ExportToolbar(p: ExportToolbarProps) {
  return (
    <div
      role="toolbar"
      aria-label="Viewer 工具列"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface px-3 py-2"
    >
      <div className="flex items-center gap-2">
        <div role="group" aria-label="裝置尺寸" className="seg">
          {DEVICE_PRESETS.map((d) => (
            <button
              key={d.id}
              type="button"
              aria-pressed={p.device.presetId === d.id}
              onClick={() => p.onDevice({ presetId: d.id, width: d.width, height: d.height })}
            >
              {d.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-pressed={p.fit}
          className="btn btn-secondary btn-sm btn-toggle"
          onClick={() => p.onFit(!p.fit)}
          title="縮放到符合畫面"
        >
          符合畫面{p.fit ? `（${Math.round(p.scale * 100)}%）` : ''}
        </button>
      </div>

      <label className="flex items-center gap-1 text-xs text-ink-2">
        頁面
        <select
          aria-label="頁面"
          value={p.pageId ?? ''}
          onChange={(e) => p.onPage(e.target.value)}
          className="input input-sm w-auto max-w-48"
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
          className="btn btn-secondary btn-sm btn-toggle"
          onClick={() => p.onShowComments(!p.showComments)}
        >
          顯示留言
        </button>
        <button
          type="button"
          aria-pressed={p.showResolved}
          className="btn btn-secondary btn-sm btn-toggle"
          onClick={() => p.onShowResolved(!p.showResolved)}
        >
          顯示已解決
        </button>
        <button
          type="button"
          aria-pressed={p.panelOpen}
          aria-expanded={p.panelOpen}
          className="btn btn-secondary btn-sm btn-toggle"
          onClick={() => p.onPanelOpen(!p.panelOpen)}
        >
          留言面板（{p.threadCount}）
        </button>
      </div>
    </div>
  );
}
