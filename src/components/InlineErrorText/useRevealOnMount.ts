import { type RefObject, useEffect, useRef } from 'react';

/**
 * Scroll the element into view once when it mounts. Inline errors usually appear
 * after a submit at the bottom of a scrollable modal or long form; without this a
 * failed click can look like a no-op. `block: 'nearest'` leaves visible errors alone.
 */
export const useRevealOnMount = <T extends HTMLElement>(): RefObject<T | null> => {
  const ref = useRef<T>(null);

  useEffect(() => {
    ref.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }, []);

  return ref;
};
