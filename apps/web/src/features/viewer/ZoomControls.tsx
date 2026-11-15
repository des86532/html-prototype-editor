import { ZOOM_MAX, ZOOM_MIN } from './zoom';

export interface ZoomControlsProps {
  zoom: 'fit' | number;
  /** 目前實際縮放比例 */
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}

/** −／百分比（點擊＝符合畫面）／＋。 */
export function ZoomControls({ zoom, scale, onZoomIn, onZoomOut, onFit }: ZoomControlsProps) {
  return (
    <div role="group" aria-label="縮放" className="seg">
      <button
        type="button"
        aria-label="縮小（-）"
        title="縮小（-）"
        disabled={scale <= ZOOM_MIN + 0.001}
        onClick={onZoomOut}
      >
        −
      </button>
      <button
        type="button"
        aria-label="符合畫面（0）"
        title="符合畫面（0）"
        aria-pressed={zoom === 'fit'}
        className="font-mono"
        onClick={onFit}
      >
        {Math.round(scale * 100)}%
      </button>
      <button
        type="button"
        aria-label="放大（+）"
        title="放大（+）"
        disabled={scale >= ZOOM_MAX - 0.001}
        onClick={onZoomIn}
      >
        +
      </button>
    </div>
  );
}
