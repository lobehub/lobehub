'use client';

import { type ReactNode, useEffect, useLayoutEffect, useState } from 'react';

import { isSkeletonHandover, retainSkeleton } from './skeletonHandover';

/**
 * Matches `BOOT_SHELL_DELAY`: below this, a placeholder is on screen for less
 * time than it takes to read as one, so it registers as a flicker between two
 * layouts rather than as loading.
 */
export const FALLBACK_DELAY = 200;

interface DelayedFallbackProps {
  children: ReactNode;
  delay?: number;
}

export const useDelayedVisible = (delay = FALLBACK_DELAY) => {
  const [elapsed, setElapsed] = useState(() => isSkeletonHandover());

  useEffect(() => {
    if (elapsed) return;
    const timer = setTimeout(() => setElapsed(true), delay);
    return () => clearTimeout(timer);
  }, [delay, elapsed]);

  useLayoutEffect(() => {
    if (!elapsed) return;
    return retainSkeleton();
  }, [elapsed]);

  return elapsed;
};

/**
 * Holds a page-level skeleton back until the wait is long enough to be worth
 * showing. A segment that resolves faster renders nothing at all — the
 * previous screen simply stays until the next one paints.
 */
const DelayedFallback = ({ children, delay }: DelayedFallbackProps) =>
  useDelayedVisible(delay) ? children : null;

/** Wraps a route fallback element so it inherits the same 200ms gate. */
export const delayed = (fallback: ReactNode) => <DelayedFallback>{fallback}</DelayedFallback>;

export default DelayedFallback;
