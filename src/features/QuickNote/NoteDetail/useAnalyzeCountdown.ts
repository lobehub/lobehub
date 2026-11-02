import { useEffect, useState } from 'react';

/**
 * Tracks the time left before a scheduled analysis starts.
 *
 * Use when:
 * - A control shows a countdown to a note's `analyzeDueAt` deadline.
 *
 * Expects:
 * - `dueAt` is an epoch timestamp in milliseconds, or `undefined` when nothing is scheduled.
 *
 * Returns:
 * - The remaining milliseconds, clamped to `0`. The clock stops on the tick that reaches the
 *   deadline, so an unchanged expired deadline does not keep scheduling renders.
 */
export const useAnalyzeCountdown = (dueAt?: number): number => {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!dueAt || dueAt <= Date.now()) return;

    setNow(Date.now());
    const interval = window.setInterval(() => {
      const currentTime = Date.now();
      setNow(currentTime);
      // Stop the visual countdown even if the next server update is delayed.
      if (currentTime >= dueAt) window.clearInterval(interval);
    }, 100);
    return () => window.clearInterval(interval);
  }, [dueAt]);

  return dueAt ? Math.max(0, dueAt - now) : 0;
};
