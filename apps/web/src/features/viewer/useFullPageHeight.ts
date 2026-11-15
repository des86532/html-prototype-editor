import { useCallback, useEffect, useRef, useState } from 'react';

export const PAGE_HEIGHT_CAP = 20_000;
export const PAGE_SETTLE_MS = 400;
export const PAGE_SETTLE_MAX_MS = 1500;

/**
 * 整頁模式的 iframe 高度：以「裝置高度下量到的頁面高度（docH）」為準，量完就固定。
 * 圖片載入等會讓 docH 連續變動，所以等 PAGE_SETTLE_MS 內沒有新訊息才定案（最久 PAGE_SETTLE_MAX_MS）。
 * 定案後頁面再變長不追高度（避免 100vh 區塊讓 iframe 無限長高）；超出部分在 iframe 內捲動。
 */
export function useFullPageHeight(opts: { frameKey: number; width: number; deviceHeight: number }) {
  const { frameKey, width, deviceHeight } = opts;
  const resetKey = `${frameKey}:${width}:${deviceHeight}`;
  const [state, setState] = useState({ resetKey, measured: deviceHeight, settled: false });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxDocH = useRef(0);
  const firstAt = useRef(0);
  const settledRef = useRef(false);
  const grewRef = useRef(false);
  const deviceHeightRef = useRef(deviceHeight);
  const resetKeyRef = useRef(resetKey);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  // render 期間偵測 key 變化並重設（同 DeviceToolbar 的 CustomSize 寫法）。
  if (state.resetKey !== resetKey) {
    setState({ resetKey, measured: deviceHeight, settled: false });
  }

  useEffect(() => {
    deviceHeightRef.current = deviceHeight;
    resetKeyRef.current = resetKey;
    settledRef.current = false;
    grewRef.current = false;
    maxDocH.current = 0;
    firstAt.current = 0;
    clear();
  }, [resetKey, deviceHeight, clear]);
  useEffect(() => clear, [clear]);

  const onScrollMessage = useCallback(
    (m: { docH: number; vh: number }) => {
      const dh = deviceHeightRef.current;
      // 量到的不是裝置高度下的版面（含 iframe 已撐高之後的訊息）：忽略
      if (Math.round(m.vh) !== dh) return;
      if (settledRef.current) {
        // 已定案但頁面其實沒有比裝置高（例如樣式表晚於第一次定案才載入）：
        // iframe 仍是裝置高度，版面有效，頁面變長就重新量測；已撐高就不再追。
        if (grewRef.current || m.docH <= dh) return;
        settledRef.current = false;
        maxDocH.current = 0;
        firstAt.current = 0;
        const key = resetKeyRef.current;
        setState((s) => (s.resetKey === key ? { ...s, settled: false } : s));
      }
      const now = Date.now();
      if (firstAt.current === 0) firstAt.current = now;
      maxDocH.current = Math.max(maxDocH.current, m.docH);
      const key = resetKeyRef.current;
      const settle = () => {
        clear();
        settledRef.current = true;
        const h = Math.min(PAGE_HEIGHT_CAP, Math.max(dh, Math.ceil(maxDocH.current)));
        grewRef.current = h > dh;
        setState((s) => (s.resetKey === key ? { resetKey: key, measured: h, settled: true } : s));
      };
      clear();
      if (now - firstAt.current >= PAGE_SETTLE_MAX_MS) settle();
      else timer.current = setTimeout(settle, PAGE_SETTLE_MS);
    },
    [clear],
  );

  const stale = state.resetKey !== resetKey;
  return {
    pageHeight: stale ? deviceHeight : state.measured,
    settled: stale ? false : state.settled,
    onScrollMessage,
  };
}
