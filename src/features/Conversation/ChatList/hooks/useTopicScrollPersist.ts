import type { RefObject } from 'react';
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
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
import { settleScrollTarget } from '../utils/settleScrollTarget';
import { isTranscriptSwap } from '../utils/transcriptSwap';

const FLUSH_THROTTLE_MS = 200;
const DEEP_LINK_MAX_ATTEMPTS = 30;
const DEEP_LINK_RETRY_MS = 16;
// Cap polling for virtua's scrollSize to settle so we don't loop forever when
// the saved offset is unreachable (e.g. messages were trimmed since save).
const RESTORE_MAX_FRAMES = 30;
// The bottom restore keeps jumping until the list height has been stable this
// long — virtua's own settle window for imperative scrolls, since measuring a
// row and re-rendering the list can take more than one frame.
const BOTTOM_SETTLE_QUIET_MS = 150;
// Upper bound while a streaming reply keeps growing; auto-scroll follows after.
const BOTTOM_SETTLE_MAX_MS = 1000;
const USER_SCROLL_INPUT_EVENTS = ['keydown', 'pointerdown', 'touchstart', 'wheel'] as const;

interface ScrollPosition {
  anchorId?: string;
  anchorOffset?: number;
  atBottom: boolean;
  offset: number;
}

interface PendingWrite extends ScrollPosition {
  key: string;
}

export type InitialScrollPosition = 'bottom' | 'top';

interface UseTopicScrollPersistOptions {
  containerRef?: RefObject<HTMLDivElement | null>;
  contextKey: string;
  /** Message row ids, in message-index space. */
  dataSource: string[];
  /**
   * Returns the VList scroll element. Snapshot and bottom restores write its
   * `scrollTop` directly: virtua's `scrollTo` / `scrollToIndex` keep
   * re-applying their target on every item resize within 150ms, so a restore
   * that lands while a reply is streaming would pin the viewport and override
   * the user's own scrolling until the stream ends.
   */
  getScroller: () => HTMLElement | null;
  /**
   * Number of synthetic rows prepended to the VList before the messages
   * (e.g. the headerSlot spacer). Added when targeting a deep-linked message
   * so scrollToIndex lands on the right virtua row.
   */
  headerOffset?: number;
  /**
   * Where a topic opens when there is no deep link. `bottom` restores the saved
   * position, or the end of the conversation; `top` always opens at the start.
   */
  initialPosition?: InitialScrollPosition;
  /** Whether the user scrolled away from the bottom to read earlier rows. */
  isDetached?: () => boolean;
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
  dataSource,
  getScroller,
  headerOffset = 0,
  initialPosition = 'bottom',
  isDetached,
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
  const lastKnownRef = useRef<ScrollPosition | null>(null);
  // Initial mount counts as a "key change" so the first restore attempt fires.
  const needsRestoreRef = useRef(true);
  const prevContextKeyRef = useRef(contextKey);
  const dataSourceLength = dataSource.length;
  const dataSourceRef = useRef(dataSource);
  dataSourceRef.current = dataSource;
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
  const prevRowsRef = useRef(dataSource);
  const swapContextKeyRef = useRef(contextKey);
  // Where to land after a transcript swap, consumed by the restore below.
  const swapTargetRef = useRef<ScrollPosition | null>(null);
  // A reader's position whose row was folded away. A failed compression brings
  // the row back, so it is kept until then rather than overwritten by the clamp.
  const heldReaderPositionRef = useRef<ScrollPosition | null>(null);

  const resolvePosition = useCallback(
    (offset: number, atBottom: boolean): ScrollPosition => {
      const ref = virtuaRef.current;
      const messages = dataSourceRef.current;
      if (!ref || messages.length === 0) return { atBottom, offset };

      const messageIndex = Math.min(
        Math.max(ref.findItemIndex(offset) - headerOffset, 0),
        messages.length - 1,
      );
      return {
        anchorId: messages[messageIndex],
        anchorOffset: offset - ref.getItemOffset(headerOffset + messageIndex),
        atBottom,
        offset,
      };
    },
    [headerOffset, virtuaRef],
  );

  const flushNow = useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const pending = pendingWriteRef.current;
    if (!pending) return;
    const { key, ...position } = pending;
    saveScrollSnapshot(key, { ...position, savedAt: Date.now() });
    pendingWriteRef.current = null;
  }, []);

  const recordScroll = useCallback(
    (offset: number, atBottom: boolean) => {
      if (restoringRef.current) return;
      const position = resolvePosition(offset, atBottom);
      lastKnownRef.current = position;
      pendingWriteRef.current = { ...position, key: contextKey };
      if (flushTimerRef.current) return;
      flushTimerRef.current = setTimeout(() => {
        flushTimerRef.current = null;
        flushNow();
      }, FLUSH_THROTTLE_MS);
    },
    [contextKey, flushNow, resolvePosition],
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
    saveScrollSnapshot(key, { ...last, savedAt: Date.now() });
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
      if (dataSourceRef.current.length > 0) {
        needsRestoreRef.current = false;
      }
      return;
    }

    needsRestoreRef.current = true;
  }, [contextKey, persistFresh]);

  // A swapped transcript leaves the offset clamped to wherever the shorter list
  // ended, and it stays there when the rows come back: the top of the history.
  // Layout effect: runs before the clamp's scroll event can be recorded as the
  // user's position.
  useLayoutEffect(() => {
    const prevRows = prevRowsRef.current;
    prevRowsRef.current = dataSource;
    if (swapContextKeyRef.current !== contextKey) {
      swapContextKeyRef.current = contextKey;
      heldReaderPositionRef.current = null;
      swapTargetRef.current = null;
      return;
    }
    if (initialPosition === 'top' || needsRestoreRef.current) return;
    if (!isTranscriptSwap(prevRows, dataSource)) return;

    const held = heldReaderPositionRef.current;
    const detached = !!isDetached?.();
    let reader = held ?? (detached ? lastKnownRef.current : null);
    if (reader && !reader.atBottom && reader.anchorId && !dataSource.includes(reader.anchorId)) {
      if (!held || detached) {
        heldReaderPositionRef.current = reader;
        return;
      }
      // The row stayed folded and the user has since moved on.
      reader = null;
    }

    heldReaderPositionRef.current = null;
    swapTargetRef.current = reader ?? { atBottom: true, offset: 0 };
    needsRestoreRef.current = true;
    restoringRef.current = true;
  }, [contextKey, dataSource, initialPosition, isDetached]);

  // Restore (or fall back to scroll-to-bottom) once data is available for
  // the active contextKey. Re-runs on contextKey or data length change.
  useEffect(() => {
    const deepLinkKey = messageDeepLink
      ? `${contextKey}:${messageDeepLink.navigationKey}`
      : undefined;
    const shouldHandleDeepLink = !!messageDeepLink && handledDeepLinkRef.current !== deepLinkKey;

    if (!needsRestoreRef.current && !shouldHandleDeepLink) return;
    if (!virtuaRef.current || dataSourceLength === 0) return;

    const swapTarget = swapTargetRef.current;
    swapTargetRef.current = null;
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
            const landed = resolvePosition(ref.scrollOffset, isAtBottom);
            lastKnownRef.current = landed;
            if (convergeSnapshot) {
              // Target was unreachable — persist the actual landing position so
              // the snapshot self-heals and future revisits don't burn the
              // polling budget.
              pendingWriteRef.current = { ...landed, key: contextKey };
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

    if (initialPosition === 'top') {
      const scroller = getScroller();
      if (scroller) scroller.scrollTop = 0;
      finalize(false);
      return;
    }

    const snapshot = swapTarget ?? loadScrollSnapshot(contextKey);
    const anchorIndex =
      snapshot && !snapshot.atBottom && snapshot.anchorId
        ? dataSourceRef.current.indexOf(snapshot.anchorId)
        : -1;

    if (!snapshot || anchorIndex < 0) {
      const scroller = getScroller();
      if (!scroller) {
        restoringRef.current = false;
        return;
      }

      // Jump to the end every frame until the list height stops changing, so
      // rows that virtua measures after the first jump still end up in view.
      // Any user scroll input ends it at once, and the time cap bounds it while
      // a streaming reply keeps growing; streaming auto-scroll follows after.
      let interrupted = false;
      const interrupt = () => {
        interrupted = true;
      };
      for (const type of USER_SCROLL_INPUT_EVENTS) {
        scroller.addEventListener(type, interrupt, { passive: true });
      }
      const stopListening = () => {
        for (const type of USER_SCROLL_INPUT_EVENTS) {
          scroller.removeEventListener(type, interrupt);
        }
      };

      const startedAt = Date.now();
      let lastChangeAt = startedAt;
      let lastScrollHeight = -1;
      const settleAtBottom = () => {
        if (restoreSequenceRef.current !== restoreSequence) {
          stopListening();
          return;
        }
        if (interrupted) {
          stopListening();
          finalize(false);
          return;
        }

        scroller.scrollTop = scroller.scrollHeight;
        const now = Date.now();
        if (scroller.scrollHeight !== lastScrollHeight) {
          lastScrollHeight = scroller.scrollHeight;
          lastChangeAt = now;
        }
        if (
          now - lastChangeAt >= BOTTOM_SETTLE_QUIET_MS ||
          now - startedAt >= BOTTOM_SETTLE_MAX_MS
        ) {
          stopListening();
          finalize(false);
          return;
        }
        requestAnimationFrame(settleAtBottom);
      };
      settleAtBottom();
      return;
    }

    // Wait for virtua to measure enough items so scrollTo(targetOffset)
    // doesn't get clamped against the still-incomplete scrollSize of the
    // freshly-mounted VList. A single rAF isn't enough — only the viewport-
    // visible items have laid out by then, and ResizeObserver hasn't reported
    // below-the-fold heights yet.
    const anchorOffset = snapshot.anchorOffset ?? 0;
    const estimatedTarget = (ref: VListHandle) =>
      ref.getItemOffset(headerOffset + anchorIndex) + anchorOffset;
    const findAnchorRow = () =>
      containerRef?.current?.querySelector<HTMLElement>(`[data-index="${anchorIndex}"]`) ?? null;
    // Once the anchor row is on screen its laid-out position is the truth;
    // virtua's offsets still count the unmeasured rows above at their estimate.
    const anchorTarget = (ref: VListHandle) => {
      const row = findAnchorRow();
      const scroller = getScroller();
      if (!row || !scroller) return estimatedTarget(ref);
      return (
        scroller.scrollTop +
        row.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        anchorOffset
      );
    };
    let attempts = 0;
    const tryScroll = () => {
      if (restoreSequenceRef.current !== restoreSequence) return;

      const ref = virtuaRef.current;
      if (!ref) {
        restoringRef.current = false;
        return;
      }
      const targetOffset = estimatedTarget(ref);
      const required = targetOffset + ref.viewportSize;
      const cappedOut = attempts >= RESTORE_MAX_FRAMES;
      if (ref.scrollSize >= required || cappedOut) {
        const scroller = getScroller();
        if (!scroller) return finalize(cappedOut);
        const aimAt = (target: number) => {
          scroller.scrollTop = target;
          lastKnownRef.current = resolvePosition(target, false);
        };
        const settleOnAnchor = () => {
          const ref = virtuaRef.current;
          if (!ref || restoreSequenceRef.current !== restoreSequence) return;
          const target = anchorTarget(ref);
          aimAt(target);
          // Rows above the anchor start at virtua's estimated size; as they are
          // measured the anchor moves, so keep re-aiming until it holds still.
          settleScrollTarget({
            aimAt,
            initialTarget: target,
            isStale: () => restoreSequenceRef.current !== restoreSequence,
            maxMs: BOTTOM_SETTLE_MAX_MS,
            onDone: () => finalize(cappedOut),
            quietMs: BOTTOM_SETTLE_QUIET_MS,
            readTarget: () => (virtuaRef.current ? anchorTarget(virtuaRef.current) : undefined),
            scroller,
            stopEvents: USER_SCROLL_INPUT_EVENTS,
          });
        };

        // Aiming more than a viewport into the anchor leaves the anchor row
        // itself outside virtua's render window, so the aim rests on estimated
        // heights and a tall reply lands a round late. Chase the row's start
        // until it renders, then aim from where it actually is.
        if (anchorOffset <= ref.viewportSize) return settleOnAnchor();
        let anchorFrames = 0;
        const revealAnchorRow = () => {
          if (restoreSequenceRef.current !== restoreSequence) return;
          const current = virtuaRef.current;
          if (findAnchorRow() || !current || ++anchorFrames >= RESTORE_MAX_FRAMES) {
            settleOnAnchor();
            return;
          }
          aimAt(current.getItemOffset(headerOffset + anchorIndex));
          requestAnimationFrame(revealAnchorRow);
        };
        revealAnchorRow();
        return;
      }
      attempts += 1;
      requestAnimationFrame(tryScroll);
    };
    requestAnimationFrame(tryScroll);
  }, [
    containerRef,
    contextKey,
    dataSource,
    dataSourceLength,
    flushNow,
    getScroller,
    headerOffset,
    initialPosition,
    messageDeepLink,
    resolvePosition,
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
