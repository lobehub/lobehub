import { useCallback, useEffect, useRef } from 'react';

const PIN_RETRY_DELAYS = [0, 32, 96];

interface UseScrollToUserMessageOptions {
  /**
   * Current data source length (number of messages)
   */
  dataSourceLength: number;
  /**
   * Whether the second-to-last message is from the user
   * (When sending a message, user + assistant messages are created as a pair)
   */
  isSecondLastMessageFromUser: boolean;
  /**
   * User is manually shrinking the spacer (scrolled up). When true, stop pinning
   * so we don't fight the user's scroll.
   */
  scrollShrinking?: boolean;
  /**
   * Function to scroll to a specific index
   */
  scrollToIndex:
    | ((index: number, options?: { align?: 'start' | 'center' | 'end'; smooth?: boolean }) => void)
    | null;
  /**
   * Whether the conversation spacer is mounted and providing fill height.
   * When the spacer mounts after the initial scroll, a follow-up scroll is
   * fired so the user message lands at the correct position once the extra
   * height is available.
   */
  spacerActive: boolean;
  /**
   * A counter that increments each time the spacer DOM's real size changes
   * (observed via ResizeObserver). Used as a layout-settled signal so we can
   * re-fire scrollToIndex after virtua finishes measuring the spacer and
   * scrollSize expands enough to let the user message reach the top.
   */
  spacerLayoutVersion?: number;
}

/**
 * Hook to handle scrolling to user message when user sends a new message.
 * Only triggers scroll when user sends a new message (detected by checking if
 * 2 new messages were added and the second-to-last is from user).
 *
 * Scrolls immediately on message send (works when content already fills the
 * viewport). When a conversation spacer mounts afterwards and its DOM is
 * measured by virtua, scrollSize expands and we re-fire scroll so the user
 * message lands correctly. The pending state clears when the spacer unmounts
 * or the user starts scrolling manually.
 */
export function useScrollToUserMessage({
  dataSourceLength,
  isSecondLastMessageFromUser,
  scrollToIndex,
  scrollShrinking = false,
  spacerActive,
  spacerLayoutVersion = 0,
}: UseScrollToUserMessageOptions): void {
  const prevLengthRef = useRef(dataSourceLength);
  const timerIdsRef = useRef<number[]>([]);
  // Index of the user message that needs to be scrolled to, or null if no pending scroll
  const pendingScrollIndexRef = useRef<number | null>(null);

  const clearPendingPins = useCallback(() => {
    timerIdsRef.current.forEach((timerId) => {
      window.clearTimeout(timerId);
    });
    timerIdsRef.current = [];
  }, []);

  const executeScroll = useCallback(
    (userMessageIndex: number) => {
      if (!scrollToIndex) return;

      clearPendingPins();

      PIN_RETRY_DELAYS.forEach((delay) => {
        const timerId = window.setTimeout(() => {
          scrollToIndex(userMessageIndex, {
            align: 'start',
            smooth: true,
          });
        }, delay);

        timerIdsRef.current.push(timerId);
      });
    },
    [clearPendingPins, scrollToIndex],
  );

  useEffect(() => {
    return clearPendingPins;
  }, [clearPendingPins]);

  // Detect when user sends a new message and scroll immediately
  useEffect(() => {
    const newMessageCount = dataSourceLength - prevLengthRef.current;
    prevLengthRef.current = dataSourceLength;

    // Only scroll when user sends a new message (2 messages added: user + assistant pair)
    if (newMessageCount === 2 && isSecondLastMessageFromUser && scrollToIndex) {
      const userMessageIndex = dataSourceLength - 2;

      // Always scroll immediately – works when content already fills the viewport.
      // Also store the index so follow-up scrolls can fire as the spacer settles.
      pendingScrollIndexRef.current = userMessageIndex;
      executeScroll(userMessageIndex);
    }
  }, [dataSourceLength, isSecondLastMessageFromUser, scrollToIndex, executeScroll]);

  // Clear pending scroll when the spacer unmounts or user scrolls manually so
  // subsequent layout ticks don't keep pinning against the user's intent.
  // Also cancel any already-scheduled retry timers — otherwise a pin wave
  // fired just before the user scrolled up would still call scrollToIndex at
  // 32/96ms and yank the viewport back down.
  useEffect(() => {
    if (!spacerActive || scrollShrinking) {
      pendingScrollIndexRef.current = null;
      clearPendingPins();
    }
  }, [spacerActive, scrollShrinking, clearPendingPins]);

  // Re-scroll whenever the spacer's real layout settles (version bumps) or the
  // spacer becomes active. Skip when user is manually shrinking the spacer.
  useEffect(() => {
    if (!spacerActive || scrollShrinking) return;
    const index = pendingScrollIndexRef.current;
    if (index === null) return;
    executeScroll(index);
  }, [spacerActive, spacerLayoutVersion, scrollShrinking, executeScroll]);
}
