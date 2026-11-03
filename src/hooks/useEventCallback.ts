import { useCallback, useLayoutEffect, useRef } from 'react';

export const useEventCallback = <T extends (...args: any[]) => any>(fn: T) => {
  const ref = useRef<T>(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  }, [fn]);
  return useCallback((...args: Parameters<T>) => {
    return ref.current(...args);
  }, []);
};
