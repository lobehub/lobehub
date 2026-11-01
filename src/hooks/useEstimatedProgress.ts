import { useEffect, useState } from 'react';

/** Estimated progress stops here until the real result arrives. */
export const MAX_ESTIMATED_PROGRESS = 99;

const PROGRESS_UPDATE_INTERVAL_MS = 1000;

interface UseEstimatedProgressOptions {
  /** Expected total duration; no positive value means there is nothing to estimate. */
  durationMs?: number | null;
  /** Whether the task is still running. Defaults to `true`. */
  enabled?: boolean;
  /**
   * sessionStorage key for the start time. Persisting it lets a remount (scrolling away,
   * switching topics) or a page refresh resume the estimate instead of restarting from 0%.
   */
  storageKey?: string;
}

const readStartTime = (storageKey?: string) => {
  const stored = storageKey ? Number(sessionStorage.getItem(storageKey)) : Number.NaN;
  if (Number.isFinite(stored) && stored > 0) return stored;

  const now = Date.now();
  if (storageKey) sessionStorage.setItem(storageKey, String(now));
  return now;
};

/**
 * Estimates the progress percentage of a running task from its elapsed time against an
 * expected duration, capped at {@link MAX_ESTIMATED_PROGRESS}. Returns `null` when inactive
 * or when no duration is known.
 */
export const useEstimatedProgress = ({
  durationMs,
  enabled = true,
  storageKey,
}: UseEstimatedProgressOptions) => {
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled || !durationMs || durationMs <= 0) {
      setProgress(null);
      return;
    }

    const startedAt = readStartTime(storageKey);
    const update = () => {
      const elapsedMs = Date.now() - startedAt;
      setProgress(Math.min(MAX_ESTIMATED_PROGRESS, Math.round((elapsedMs / durationMs) * 100)));
    };

    update();
    const timer = window.setInterval(update, PROGRESS_UPDATE_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [durationMs, enabled, storageKey]);

  return progress;
};
