import type { RefObject } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { VListHandle } from 'virtua';

import {
  clearReadingAnchor,
  loadReadingAnchor,
  pruneReadingAnchors,
  type ReadingAnchor,
  saveReadingAnchor,
} from '../utils/readingAnchorStore';
import { useDeepLinkHistoryBackfill } from './useDeepLinkHistoryBackfill';

const FLUSH_THROTTLE_MS = 200;
/**
 * Frames to keep re-aiming at the anchor while rows above it and the anchor
 * row itself are measured; each re-aim uses virtua's latest measurements.
 */
const RESTORE_FRAMES = 30;
const USER_SCROLL_INPUT_EVENTS = ['keydown', 'pointerdown', 'touchstart', 'wheel'] as const;

interface UseReadingAnchorOptions {
  contextKey: string;
  /** Message row ids, in message-index space. */
  dataSource: string[];
  enabled: boolean;
  getScroller: () => HTMLElement | null;
  /** Synthetic rows before the first message in the virtua list. */
  headerOffset: number;
  /** Loads the next page toward rows not loaded yet. */
  loadPage: () => Promise<void>;
  virtuaRef: RefObject<VListHandle | null>;
}

interface PendingResume {
  anchor: ReadingAnchor;
  key: string;
}

const readPendingResume = (key: string, enabled: boolean): PendingResume | null => {
  if (!enabled) return null;
  const anchor = loadReadingAnchor(key);
  return anchor ? { anchor, key } : null;
};

/**
 * Remembers which message the reader had at the top of the viewport and, on
 * the next visit to the same conversation, pages it in and scrolls back to it.
 * Any scroll input before the anchor is reached cancels the pending restore.
 */
export const useReadingAnchor = ({
  contextKey,
  dataSource,
  enabled,
  getScroller,
  headerOffset,
  loadPage,
  virtuaRef,
}: UseReadingAnchorOptions) => {
  // Read during the first render: a scroll event fired at mount must already
  // see the pending restore, or it would record the top and clear the anchor.
  const [pending, setPending] = useState(() => readPendingResume(contextKey, enabled));
  const loadedForRef = useRef(`${enabled}:${contextKey}`);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const dataSourceRef = useRef(dataSource);
  dataSourceRef.current = dataSource;
  const contextKeyRef = useRef(contextKey);
  contextKeyRef.current = contextKey;

  /** `null` clears the anchor: the reader is back at the start. */
  const pendingWriteRef = useRef<{ anchor: ReadingAnchor | null; key: string } | undefined>(
    undefined,
  );
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The restore's own scrolls pass through positions that are not the reader's. */
  const restoringRef = useRef(false);

  useEffect(() => {
    const loadedFor = `${enabled}:${contextKey}`;
    if (loadedForRef.current === loadedFor) return;
    loadedForRef.current = loadedFor;
    setPending(readPendingResume(contextKey, enabled));
  }, [contextKey, enabled]);

  useEffect(() => {
    pruneReadingAnchors();
  }, []);

  const targetIndex = pending ? dataSource.indexOf(pending.anchor.messageId) : -1;

  useDeepLinkHistoryBackfill({
    deepLinkKey: pending ? `reading-anchor:${pending.key}` : undefined,
    loadedCount: dataSource.length,
    loadPage,
    ready: dataSource.length > 0,
    resolved: targetIndex >= 0,
  });

  useEffect(() => {
    const ref = virtuaRef.current;
    if (!pending || targetIndex < 0 || !ref) return;
    setPending(null);

    const target = headerOffset + targetIndex;
    const { offset } = pending.anchor;
    const scroller = getScroller();
    restoringRef.current = true;
    let stopped = false;
    let frame = 0;
    const stop = () => {
      stopped = true;
    };
    for (const type of USER_SCROLL_INPUT_EVENTS) {
      scroller?.addEventListener(type, stop, { passive: true });
    }
    const cleanup = () => {
      restoringRef.current = false;
      for (const type of USER_SCROLL_INPUT_EVENTS) {
        scroller?.removeEventListener(type, stop);
      }
    };

    const step = () => {
      const current = virtuaRef.current;
      if (stopped || !current || frame >= RESTORE_FRAMES) {
        cleanup();
        return;
      }
      current.scrollToIndex(target, { align: 'start', offset });
      frame += 1;
      requestAnimationFrame(step);
    };
    step();
  }, [getScroller, headerOffset, pending, targetIndex, virtuaRef]);

  const flush = useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const write = pendingWriteRef.current;
    if (!write) return;
    pendingWriteRef.current = undefined;
    if (write.anchor) saveReadingAnchor(write.key, write.anchor);
    else clearReadingAnchor(write.key);
  }, []);

  /** Queues the viewport's top message, or a clear when it is on the header. */
  const recordPosition = useCallback(() => {
    const ref = virtuaRef.current;
    if (!ref) return;

    const row = ref.findItemIndex(ref.scrollOffset);
    const messageIndex = row - headerOffset;
    const messages = dataSourceRef.current;
    let anchor: ReadingAnchor | null;
    if (messageIndex < 0) {
      anchor = null;
    } else if (messageIndex < messages.length) {
      anchor = {
        messageId: messages[messageIndex],
        offset: Math.max(0, ref.scrollOffset - ref.getItemOffset(row)),
        savedAt: Date.now(),
      };
    } else {
      // Footer and spacer rows carry no message to come back to.
      return;
    }

    pendingWriteRef.current = { anchor, key: contextKeyRef.current };
    if (flushTimerRef.current) return;
    flushTimerRef.current = setTimeout(flush, FLUSH_THROTTLE_MS);
  }, [flush, headerOffset, virtuaRef]);

  /**
   * Call on every scroll event. Records the landing position of smooth-scroll
   * and momentum tails too, which arrive after the reader's input has ended.
   * Scrolls without input do not record while a restore is pending or running.
   */
  const onScroll = useCallback(
    (fromUserInput: boolean) => {
      if (!enabled) return;
      if (fromUserInput) {
        if (pendingRef.current) setPending(null);
      } else if (pendingRef.current || restoringRef.current) {
        return;
      }
      recordPosition();
    },
    [enabled, recordPosition],
  );

  // While pages load, input that cannot scroll (Home at the top, an upward
  // wheel) fires no scroll event, so listen for the input itself and record
  // where the reader is: on the header that clears the stale anchor.
  const isPending = !!pending;
  useEffect(() => {
    const scroller = getScroller();
    if (!isPending || !scroller) return;
    const cancel = () => {
      setPending(null);
      recordPosition();
    };
    for (const type of USER_SCROLL_INPUT_EVENTS) {
      scroller.addEventListener(type, cancel, { passive: true });
    }
    return () => {
      for (const type of USER_SCROLL_INPUT_EVENTS) {
        scroller.removeEventListener(type, cancel);
      }
    };
  }, [getScroller, isPending, recordPosition]);

  useEffect(() => {
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [flush]);

  return { onScroll };
};
