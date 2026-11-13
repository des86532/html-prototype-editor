/** 前緣節流：`intervalMs` 內只放行第一次。用來避免迴圈呼叫 alert()／表單 submit 灌爆 parent（V11）。 */
export function createLeadingThrottle(
  intervalMs: number,
  now: () => number = () => Date.now(),
): () => boolean {
  let last = -Infinity;
  return () => {
    const t = now();
    if (t - last < intervalMs) return false;
    last = t;
    return true;
  };
}

/** 取字串前 `max` 個字元；任何無法轉成字串的值（例如 toString 會丟錯的物件）回傳空字串。 */
export function safeText(value: unknown, max: number): string {
  try {
    return String(value ?? '').slice(0, max);
  } catch {
    return '';
  }
}
