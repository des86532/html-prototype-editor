export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 3;
export const ZOOM_STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3] as const;

const EPS = 0.001;

/** 從目前的實際縮放比例往上（dir=1）或往下（dir=-1）找下一個 step；誤差 0.001 內視為同一級；超出範圍回傳邊界值。 */
export function zoomStep(current: number, dir: 1 | -1): number {
  if (dir === 1) {
    return ZOOM_STEPS.find((s) => s > current + EPS) ?? ZOOM_MAX;
  }
  return [...ZOOM_STEPS].reverse().find((s) => s < current - EPS) ?? ZOOM_MIN;
}

/** ⌘／Ctrl＋滾輪：dyPx 已換算成 px；向上滾（負值）放大。 */
export function wheelZoom(current: number, dyPx: number): number {
  const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current * Math.exp(-dyPx * 0.002)));
  return Math.round(next * 1000) / 1000;
}
