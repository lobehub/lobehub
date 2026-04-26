import type { RefObject } from 'react';
import { useCallback, useEffect, useRef } from 'react';
import type { VListHandle } from 'virtua';

import {
  loadScrollSnapshot,
  pruneScrollSnapshots,
  saveScrollSnapshot,
} from '../utils/scrollSnapshotStore';

const FLUSH_THROTTLE_MS = 200;

interface PendingWrite {
  atBottom: boolean;
  key: string;
  offset: number;
}

interface UseTopicScrollPersistOptions {
  contextKey: string;
  dataSourceLength: number;
  virtuaRef: RefObject<VListHandle | null>;
}

/**
 * Persists per-topic chat scroll position to localStorage.
 *
 * The Provider does not remount on topic switch — the same VirtualizedList
 * instance handles every topic, so we react to `contextKey` changes ourselves
 * to flush the previous topic and restore the next.
 */
export const useTopicScrollPersist = ({
  contextKey,
  dataSourceLength,
  virtuaRef,
}: UseTopicScrollPersistOptions) => {
  const pendingWriteRef = useRef<PendingWrite | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Initial mount counts as a "key change" so the first restore attempt fires.
  const needsRestoreRef = useRef(true);

  const flushNow = useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const pending = pendingWriteRef.current;
    if (!pending) return;
    saveScrollSnapshot(pending.key, {
      atBottom: pending.atBottom,
      offset: pending.offset,
      savedAt: Date.now(),
    });
    pendingWriteRef.current = null;
  }, []);

  const recordScroll = useCallback(
    (offset: number, atBottom: boolean) => {
      pendingWriteRef.current = { atBottom, key: contextKey, offset };
      if (flushTimerRef.current) return;
      flushTimerRef.current = setTimeout(() => {
        flushTimerRef.current = null;
        flushNow();
      }, FLUSH_THROTTLE_MS);
    },
    [contextKey, flushNow],
  );

  // Flush previous topic synchronously before switching, then arm a restore.
  useEffect(() => {
    flushNow();
    needsRestoreRef.current = true;
  }, [contextKey, flushNow]);

  // Restore (or fall back to scroll-to-bottom) once data is available for
  // the active contextKey. Re-runs on contextKey or data length change.
  useEffect(() => {
    if (!needsRestoreRef.current) return;
    if (!virtuaRef.current || dataSourceLength === 0) return;

    needsRestoreRef.current = false;

    const snapshot = loadScrollSnapshot(contextKey);

    if (snapshot && !snapshot.atBottom) {
      // virtua needs item sizes measured before scrollTo lands at the right
      // pixel — defer one frame so the just-mounted items have layout.
      requestAnimationFrame(() => {
        virtuaRef.current?.scrollTo(snapshot.offset);
      });
      return;
    }

    virtuaRef.current.scrollToIndex(dataSourceLength - 1, { align: 'end' });
  }, [contextKey, dataSourceLength, virtuaRef]);

  // One-shot housekeeping: drop expired entries and enforce the cap.
  useEffect(() => {
    pruneScrollSnapshots();
  }, []);

  // Flush on unmount and on tab close so the most recent offset survives.
  useEffect(() => {
    const handleBeforeUnload = () => flushNow();
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      flushNow();
    };
  }, [flushNow]);

  return { recordScroll };
};
