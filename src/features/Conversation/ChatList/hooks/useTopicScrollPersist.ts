import type { RefObject } from 'react';
import { useCallback, useEffect, useRef } from 'react';
import type { VListHandle } from 'virtua';

import { AT_BOTTOM_THRESHOLD } from '../components/AutoScroll/const';
import type { ResolvedMessageDeepLink } from '../utils/messageDeepLink';
import {
  isDraftPromotionKey,
  loadScrollSnapshot,
  migrateScrollSnapshot,
  pruneScrollSnapshots,
  saveScrollSnapshot,
} from '../utils/scrollSnapshotStore';

const FLUSH_THROTTLE_MS = 200;
const DEEP_LINK_MAX_ATTEMPTS = 30;
const DEEP_LINK_RETRY_MS = 16;
// Cap polling for virtua's scrollSize to settle so we don't loop forever when
// the saved offset is unreachable (e.g. messages were trimmed since save).
const RESTORE_MAX_FRAMES = 30;

interface PendingWrite {
  atBottom: boolean;
  key: string;
  offset: number;
}

interface UseTopicScrollPersistOptions {
  containerRef?: RefObject<HTMLDivElement | null>;
  contextKey: string;
  dataSourceLength: number;
  /**
   * Number of synthetic rows prepended to the VList before the messages
   * (e.g. the headerSlot spacer). Added when targeting the last message so
   * scrollToIndex lands on the right virtua row.
   */
  headerOffset?: number;
  messageDeepLink?: ResolvedMessageDeepLink;
  virtuaRef: RefObject<VListHandle | null>;
}

const findDeepLinkElement = (
  container: HTMLDivElement,
  messageId: string,
  displayMessageId: string,
) => {
  const document = container.ownerDocument;
  const exactCandidateIds = [messageId, `${messageId}__answer`, `${messageId}__workflow`];

  for (const id of exactCandidateIds) {
    const element = document.getElementById(id);
    if (element && container.contains(element)) return { element, exact: true };
  }

  const messageElements = Array.from(container.querySelectorAll<HTMLElement>('[data-message-id]'));
  const exactMessageElement = messageElements.find(
    (element) => element.dataset.messageId === messageId,
  );
  if (exactMessageElement) return { element: exactMessageElement, exact: true };

  if (messageId === displayMessageId) return;

  const fallbackCandidateIds = [
    displayMessageId,
    `${displayMessageId}__answer`,
    `${displayMessageId}__workflow`,
  ];
  for (const id of fallbackCandidateIds) {
    const element = document.getElementById(id);
    if (element && container.contains(element)) return { element, exact: false };
  }

  const displayMessageElement = messageElements.find(
    (element) => element.dataset.messageId === displayMessageId,
  );
  return displayMessageElement ? { element: displayMessageElement, exact: false } : undefined;
};

/**
 * Persists per-topic chat scroll position to localStorage.
 *
 * The provider is not keyed by context, so switching to a topic whose messages
 * are already cached keeps VirtualizedList mounted and lands in the
 * contextKey-change branch below: re-stamp the topic being left, then restore
 * (or scroll to bottom) for the new one. Switching to an uncached topic still
 * unmounts VirtualizedList behind ChatList's SkeletonList and re-initializes
 * the hook fresh. The draft → real-id promotion path also flows through the
 * contextKey-change branch, preserving scroll instead of restoring.
 */
export const useTopicScrollPersist = ({
  containerRef,
  contextKey,
  dataSourceLength,
  headerOffset = 0,
  messageDeepLink,
  virtuaRef,
}: UseTopicScrollPersistOptions) => {
  const pendingWriteRef = useRef<PendingWrite | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The most recent known scroll position for the active topic, kept in sync on
  // every user scroll and seeded once a restore lands. Unlike `pendingWriteRef`
  // (cleared after each throttled flush), this survives idle reading so a
  // leave-time re-stamp can refresh `savedAt` even when the user hasn't
  // scrolled — see `persistFresh`.
  const lastKnownRef = useRef<{ atBottom: boolean; offset: number } | null>(null);
  // Initial mount counts as a "key change" so the first restore attempt fires.
  const needsRestoreRef = useRef(true);
  const prevContextKeyRef = useRef(contextKey);
  const dataSourceLengthRef = useRef(dataSourceLength);
  dataSourceLengthRef.current = dataSourceLength;
  // Mirror the active key so unmount / beforeunload handlers (bound once) can
  // re-stamp the topic the user is actually leaving.
  const contextKeyRef = useRef(contextKey);
  contextKeyRef.current = contextKey;
  // True from the moment a restore starts until the resulting onScroll has
  // settled. Without this guard, the programmatic scroll would feed back into
  // recordScroll and overwrite the snapshot — typically with offset 0 when
  // virtua clamps the target, locking the user at the top on every revisit.
  const restoringRef = useRef(false);
  const handledDeepLinkRef = useRef<string | undefined>(undefined);
  const restoreSequenceRef = useRef(0);

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
      if (restoringRef.current) return;
      lastKnownRef.current = { atBottom, offset };
      pendingWriteRef.current = { atBottom, key: contextKey, offset };
      if (flushTimerRef.current) return;
      flushTimerRef.current = setTimeout(() => {
        flushTimerRef.current = null;
        flushNow();
      }, FLUSH_THROTTLE_MS);
    },
    [contextKey, flushNow],
  );

  // Re-stamp the last known position for `key` with a fresh `savedAt`. Called
  // when the user leaves a topic (switch, unmount, or tab close) so the 5-min
  // restore window is measured from *departure*, not from the last scroll —
  // otherwise idle-reading a topic for over 5 min would expire its snapshot
  // before the user even leaves. No-op until a position is known (the user
  // never scrolled and no restore has landed).
  const persistFresh = useCallback((key: string) => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    pendingWriteRef.current = null;
    const last = lastKnownRef.current;
    if (!last) return;
    saveScrollSnapshot(key, { atBottom: last.atBottom, offset: last.offset, savedAt: Date.now() });
  }, []);

  // On contextKey change: re-stamp the previous key with the latest position,
  // then either preserve scroll (draft → real-id promotion of the same
  // conversation) or arm a restore (real topic switch).
  useEffect(() => {
    const prevKey = prevContextKeyRef.current;
    if (prevKey === contextKey) return;
    prevContextKeyRef.current = contextKey;

    // Re-stamp the topic we're leaving so its snapshot stays within the restore
    // window if the user comes back soon.
    persistFresh(prevKey);

    if (isDraftPromotionKey(prevKey, contextKey)) {
      // `onTopicCreated` mutates context mid-stream: same conversation, new
      // key. Move the snapshot so future visits resolve the new key, and
      // skip the restore so we don't yank the user away from content they
      // were already reading.
      migrateScrollSnapshot(prevKey, contextKey);
      // If data hasn't rendered yet, leave the default first-mount restore
      // (scroll-to-bottom) in place — there's nothing to preserve.
      if (dataSourceLengthRef.current > 0) {
        needsRestoreRef.current = false;
      }
      return;
    }

    needsRestoreRef.current = true;
  }, [contextKey, persistFresh]);

  // Restore (or fall back to scroll-to-bottom) once data is available for
  // the active contextKey. Re-runs on contextKey or data length change.
  useEffect(() => {
    const deepLinkKey = messageDeepLink
      ? `${contextKey}:${messageDeepLink.navigationKey}`
      : undefined;
    const shouldHandleDeepLink = !!messageDeepLink && handledDeepLinkRef.current !== deepLinkKey;

    if (!needsRestoreRef.current && !shouldHandleDeepLink) return;
    if (!virtuaRef.current || dataSourceLength === 0) return;

    needsRestoreRef.current = false;
    restoringRef.current = true;
    const restoreSequence = ++restoreSequenceRef.current;

    // After two rAFs the programmatic scroll's onScroll volley has flushed, so
    // we can re-enable recording and record where the restore landed.
    const finalize = (convergeSnapshot: boolean) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (restoreSequenceRef.current !== restoreSequence) return;

          const ref = virtuaRef.current;
          if (ref) {
            const isAtBottom =
              ref.scrollSize - ref.scrollOffset - ref.viewportSize <= AT_BOTTOM_THRESHOLD;
            // Seed the last-known position from where the restore actually
            // landed so a later leave-time re-stamp (persistFresh) has a
            // position to refresh even if the user reads without scrolling.
            lastKnownRef.current = { atBottom: isAtBottom, offset: ref.scrollOffset };
            if (convergeSnapshot) {
              // Target was unreachable — persist the actual landing position so
              // the snapshot self-heals and future revisits don't burn the
              // polling budget.
              pendingWriteRef.current = {
                atBottom: isAtBottom,
                key: contextKey,
                offset: ref.scrollOffset,
              };
              flushNow();
            }
          }
          restoringRef.current = false;
        });
      });
    };

    if (shouldHandleDeepLink && messageDeepLink) {
      const targetDeepLink = messageDeepLink;
      handledDeepLinkRef.current = deepLinkKey;
      virtuaRef.current.scrollToIndex(headerOffset + targetDeepLink.index, { align: 'center' });

      const container = containerRef?.current;
      if (!container) {
        targetDeepLink.onHandled?.();
        finalize(false);
        return;
      }

      // `scrollToIndex` first mounts the virtual row. Wait until its real DOM
      // node exists, then center the exact nested assistant block when
      // available. Timer polling keeps this progressing when Chromium suspends
      // animation frames for a non-painting view, while still allowing virtua
      // to measure between attempts.
      let attempts = 0;
      const locateTarget = () => {
        if (restoreSequenceRef.current !== restoreSequence) return;

        const ref = virtuaRef.current;
        if (!ref) {
          restoringRef.current = false;
          return;
        }

        const targetMatch = findDeepLinkElement(
          container,
          targetDeepLink.id,
          targetDeepLink.displayMessageId,
        );
        if (targetMatch?.exact) {
          targetMatch.element.scrollIntoView({ block: 'center' });
          targetDeepLink.onHandled?.();
          finalize(false);
          return;
        }

        if (attempts >= DEEP_LINK_MAX_ATTEMPTS) {
          // A nested message can be absent while its process fold is collapsed
          // or its compressed group is showing the summary tab. Keep the hash
          // pending instead of consuming the deep link at the owning row, so a
          // later render can retry the exact target.
          handledDeepLinkRef.current = undefined;
          targetMatch?.element.scrollIntoView({ block: 'center' });
          finalize(false);
          return;
        }

        attempts += 1;
        ref.scrollToIndex(headerOffset + targetDeepLink.index, { align: 'center' });
        setTimeout(locateTarget, DEEP_LINK_RETRY_MS);
      };
      setTimeout(locateTarget, DEEP_LINK_RETRY_MS);
      return;
    }

    const snapshot = loadScrollSnapshot(contextKey);
    const targetOffset = snapshot && !snapshot.atBottom ? snapshot.offset : null;

    if (targetOffset === null) {
      virtuaRef.current.scrollToIndex(headerOffset + dataSourceLength - 1, { align: 'end' });
      finalize(false);
      return;
    }

    // Wait for virtua to measure enough items so scrollTo(targetOffset)
    // doesn't get clamped against the still-incomplete scrollSize of the
    // freshly-mounted VList. A single rAF isn't enough — only the viewport-
    // visible items have laid out by then, and ResizeObserver hasn't reported
    // below-the-fold heights yet.
    let attempts = 0;
    const tryScroll = () => {
      if (restoreSequenceRef.current !== restoreSequence) return;

      const ref = virtuaRef.current;
      if (!ref) {
        restoringRef.current = false;
        return;
      }
      const required = targetOffset + ref.viewportSize;
      const cappedOut = attempts >= RESTORE_MAX_FRAMES;
      if (ref.scrollSize >= required || cappedOut) {
        ref.scrollTo(targetOffset);
        finalize(cappedOut);
        return;
      }
      attempts += 1;
      requestAnimationFrame(tryScroll);
    };
    requestAnimationFrame(tryScroll);
  }, [
    containerRef,
    contextKey,
    dataSourceLength,
    flushNow,
    headerOffset,
    messageDeepLink,
    virtuaRef,
  ]);

  // One-shot housekeeping: drop expired entries and enforce the cap.
  useEffect(() => {
    pruneScrollSnapshots();
  }, []);

  // Re-stamp on unmount (topic switch remounts this list) and on tab close so
  // the latest position survives with a fresh `savedAt`. Reading virtuaRef here
  // is unreliable — VList's imperative handle is detached before this cleanup
  // runs — so we rely on the continuously-tracked lastKnownRef instead.
  useEffect(() => {
    const handleBeforeUnload = () => persistFresh(contextKeyRef.current);
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      persistFresh(contextKeyRef.current);
    };
  }, [persistFresh]);

  return { recordScroll };
};
