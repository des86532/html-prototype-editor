import { useLayoutEffect, useRef, type RefObject } from 'react';

/** 讓 callback／effect 讀到最新的 value，而不必把它放進依賴（commit 後才更新，不在 render 期間寫 ref）。 */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
