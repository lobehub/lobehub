'use client';

import { useCallback, useEffect } from 'react';

import type { RealtimeDictationClient } from './client';

const REFRESH_INTERVAL_MS = 30_000;
const RECENT_ACTIVITY_MS = 120_000;

export const useDictationPrefetch = (
  client: RealtimeDictationClient | undefined,
  enabled: boolean,
) => {
  const prefetch = useCallback(() => {
    if (!enabled || !client) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    void client.prefetch();
  }, [client, enabled]);

  useEffect(() => {
    if (!enabled || !client || typeof window === 'undefined') return;

    let lastActivityAt = Date.now();
    const markActivity = () => {
      lastActivityAt = Date.now();
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') prefetch();
    };
    const refresh = setInterval(() => {
      if (Date.now() - lastActivityAt <= RECENT_ACTIVITY_MS) prefetch();
    }, REFRESH_INTERVAL_MS);

    prefetch();
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', prefetch);
    window.addEventListener('pointerdown', markActivity, { passive: true });
    window.addEventListener('keydown', markActivity);
    return () => {
      clearInterval(refresh);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', prefetch);
      window.removeEventListener('pointerdown', markActivity);
      window.removeEventListener('keydown', markActivity);
    };
  }, [client, enabled, prefetch]);

  return prefetch;
};
