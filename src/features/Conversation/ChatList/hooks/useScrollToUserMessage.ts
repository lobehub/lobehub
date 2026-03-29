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
   * Function to scroll to a specific index
   */
  scrollToIndex:
    | ((index: number, options?: { align?: 'start' | 'center' | 'end'; smooth?: boolean }) => void)
    | null;
  /**
   * Whether the conversation spacer is mounted and providing fill height.
   * Scroll is deferred until the spacer is active so there is enough
   * scrollable height to pin the user message to the top.
   */
  spacerActive: boolean;
}

/**
 * Hook to handle scrolling to user message when user sends a new message.
 * Only triggers scroll when user sends a new message (detected by checking if
 * 2 new messages were added and the second-to-last is from user).
 *
 * Scroll is deferred until the conversation spacer is mounted so the extra
 * fill height is available in the scroll container.
 *
 * This ensures that in group chat scenarios, when multiple agents are responding,
 * the view doesn't jump around as each agent starts speaking.
 */
export function useScrollToUserMessage({
  dataSourceLength,
  isSecondLastMessageFromUser,
  scrollToIndex,
  spacerActive,
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

  // Detect when user sends a new message and mark pending scroll
  useEffect(() => {
    const newMessageCount = dataSourceLength - prevLengthRef.current;
    prevLengthRef.current = dataSourceLength;

    // Only scroll when user sends a new message (2 messages added: user + assistant pair)
    if (newMessageCount === 2 && isSecondLastMessageFromUser && scrollToIndex) {
      const userMessageIndex = dataSourceLength - 2;

      if (spacerActive) {
        // Spacer already mounted (e.g. from previous message) – scroll immediately
        executeScroll(userMessageIndex);
      } else {
        // Defer scroll until spacer mounts and provides enough height
        pendingScrollIndexRef.current = userMessageIndex;
      }
    }
  }, [dataSourceLength, isSecondLastMessageFromUser, scrollToIndex, spacerActive, executeScroll]);

  // Execute deferred scroll once spacer becomes active
  useEffect(() => {
    if (spacerActive && pendingScrollIndexRef.current !== null) {
      const index = pendingScrollIndexRef.current;
      pendingScrollIndexRef.current = null;
      executeScroll(index);
    }
  }, [spacerActive, executeScroll]);
}
