import { useState } from 'react';
import { DEVICE_PRESETS, type Mode, type PageInfo } from '@hpe/shared';
import type { DeviceState } from '@/state/uiStore';

export interface DeviceToolbarProps {
  device: DeviceState;
  onDevice: (d: DeviceState) => void;
  fit: boolean;
  onFit: (v: boolean) => void;
  scale: number;
  mode: Mode;
  onMode: (m: Mode) => void;
  /** viewer 角色或尚未留名：Comment 模式停用 */
  canComment: boolean;
  showComments: boolean;
  onShowComments: (v: boolean) => void;
  showResolved: boolean;
  onShowResolved: (v: boolean) => void;
  panelOpen: boolean;
  onPanelOpen: (v: boolean) => void;
  threadCount: number;
  pages: readonly PageInfo[];
  /** agent 回報的目前頁面 */
  pageId: string | null;
  onPage: (path: string) => void;
  /** 擁有者才有 */
  onExport?: () => void;
}

const MIN_SIZE = 200;
const MAX_SIZE = 4000;

const btn = (active: boolean) =>
  `rounded-md border px-2 py-1 text-xs ${
    active
      ? 'border-blue-600 bg-blue-600 text-white'
      : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50'
  } disabled:cursor-not-allowed disabled:opacity-50`;

function CustomSize({ device, onDevice }: Pick<DeviceToolbarProps, 'device' | 'onDevice'>) {
  const [w, setW] = useState(String(device.width));
  const [h, setH] = useState(String(device.height));
  const [prev, setPrev] = useState(device);
  if (prev !== device) {
    setPrev(device);
    setW(String(device.width));
    setH(String(device.height));
  }
  const apply = (nw: string, nh: string) => {
    const width = Number(nw);
    const height = Number(nh);
    if (
      Number.isInteger(width) &&
      Number.isInteger(height) &&
      width >= MIN_SIZE &&
      width <= MAX_SIZE &&
      height >= MIN_SIZE &&
      height <= MAX_SIZE
    ) {
      onDevice({ presetId: 'custom', width, height });
    }
  };
  const field = (
    label: string,
    value: string,
    set: (v: string) => void,
    other: () => string,
    first: boolean,
  ) => (
    <input
      aria-label={label}
      type="number"
      inputMode="numeric"
      min={MIN_SIZE}
      max={MAX_SIZE}
      value={value}
      onChange={(e) => {
        set(e.target.value);
        apply(first ? e.target.value : other(), first ? other() : e.target.value);
      }}
      className="w-16 rounded-md border border-neutral-300 px-1.5 py-1 text-xs"
    />
  );
  return (
    <div className="flex items-center gap-1" role="group" aria-label="自訂尺寸">
      {field('自訂寬度', w, setW, () => h, true)}
      <span aria-hidden="true" className="text-xs text-neutral-500">
        ×
      </span>
      {field('自訂高度', h, setH, () => w, false)}
    </div>
  );
}

export function DeviceToolbar(p: DeviceToolbarProps) {
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
        <CustomSize device={p.device} onDevice={p.onDevice} />
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

      <div role="group" aria-label="模式" className="flex items-center gap-1">
        <button
          type="button"
          aria-pressed={p.mode === 'interact'}
          className={btn(p.mode === 'interact')}
          onClick={() => p.onMode('interact')}
        >
          Interact
        </button>
        <button
          type="button"
          aria-pressed={p.mode === 'comment'}
          disabled={!p.canComment}
          title={p.canComment ? '留言模式（C）' : '你沒有留言權限'}
          className={btn(p.mode === 'comment')}
          onClick={() => p.onMode('comment')}
        >
          Comment（C）
        </button>
      </div>

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

      {p.onExport && (
        <button type="button" className={`${btn(false)} ml-auto`} onClick={p.onExport}>
          匯出
        </button>
      )}
    </div>
  );
}
