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

  useEffect(() => {
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') void flushPendingWrites();
    };
    const flushOnPageHide = () => void flushPendingWrites();

    document.addEventListener('visibilitychange', flushWhenHidden);
    window.addEventListener('pagehide', flushOnPageHide);

    return () => {
      document.removeEventListener('visibilitychange', flushWhenHidden);
      window.removeEventListener('pagehide', flushOnPageHide);
      void flushPendingWrites();
    };
  }, [flushPendingWrites]);
};
