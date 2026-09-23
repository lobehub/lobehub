import { useEffect } from 'react';

import { useQuickNoteStore } from '@/store/quickNote';

/**
 * Flushes debounced Quick Note writes when the current document is leaving active use.
 *
 * Use when:
 * - A mounted Quick Note surface can own pending editor writes.
 *
 * Expects:
 * - The store flush operation is idempotent when no note is dirty.
 *
 * Returns:
 * - Nothing; it binds and cleans up browser lifecycle listeners.
 */
export const useQuickNotePersistenceLifecycle = (): void => {
  const flushPendingWrites = useQuickNoteStore((state) => state.flushPendingWrites);

  const setPollingActive = useQuickNoteStore((state) => state.setPollingActive);

  useEffect(() => {
    const flushWhenHidden = () => {
      const visible = document.visibilityState !== 'hidden';
      setPollingActive(visible);
      if (!visible) void flushPendingWrites();
    };
    const flushOnPageHide = () => {
      setPollingActive(false);
      void flushPendingWrites();
    };
    flushWhenHidden();

    document.addEventListener('visibilitychange', flushWhenHidden);
    window.addEventListener('pagehide', flushOnPageHide);
    window.addEventListener('pageshow', flushWhenHidden);

    return () => {
      document.removeEventListener('visibilitychange', flushWhenHidden);
      window.removeEventListener('pagehide', flushOnPageHide);
      window.removeEventListener('pageshow', flushWhenHidden);
      setPollingActive(false);
      void flushPendingWrites();
    };
  }, [flushPendingWrites, setPollingActive]);
};
