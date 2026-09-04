'use client';

import { type ReactNode, useEffect, useState } from 'react';

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

/**
 * Holds a page-level skeleton back until the wait is long enough to be worth
 * showing. A segment that resolves faster renders nothing at all — the
 * previous screen simply stays until the next one paints.
 */
const DelayedFallback = ({ children, delay = FALLBACK_DELAY }: DelayedFallbackProps) => {
  const [elapsed, setElapsed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setElapsed(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);

  return elapsed ? children : null;
};

/** Wraps a route fallback element so it inherits the same 200ms gate. */
export const delayed = (fallback: ReactNode) => <DelayedFallback>{fallback}</DelayedFallback>;

export default DelayedFallback;
