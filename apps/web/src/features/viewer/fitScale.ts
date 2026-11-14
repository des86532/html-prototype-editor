/** 畫布 p-8 左右（上下）合計 */
export const FIT_PADDING_PX = 64;

/** 讓整個裝置畫面（寬與高）都落在畫布內的縮放比例；不放大，最小 0.1。 */
export function fitScale(
  container: { w: number; h: number },
  device: { width: number; height: number },
  padding: number = FIT_PADDING_PX,
): number {
  if (container.w <= 0 || container.h <= 0) return 1;
  return Math.max(
    0.1,
    Math.min(1, (container.w - padding) / device.width, (container.h - padding) / device.height),
  );
}
