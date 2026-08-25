import { useRef } from 'react';

export const useSingleton = <T>(factory: () => T): T => {
  const ref = useRef<{ value: T } | null>(null);
  if (ref.current === null) {
    ref.current = { value: factory() };
  }
  return ref.current.value;
};
