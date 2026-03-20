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
}

/**
 * Hook to handle scrolling to user message when user sends a new message.
 * Only triggers scroll when user sends a new message (detected by checking if
 * 2 new messages were added and the second-to-last is from user).
 *
 * This ensures that in group chat scenarios, when multiple agents are responding,
 * the view doesn't jump around as each agent starts speaking.
 */
export function useScrollToUserMessage({
  dataSourceLength,
  isSecondLastMessageFromUser,
  scrollToIndex,
}: UseScrollToUserMessageOptions): void {
  const prevLengthRef = useRef(dataSourceLength);
  const timerIdsRef = useRef<number[]>([]);

  const clearPendingPins = useCallback(() => {
    timerIdsRef.current.forEach((timerId) => {
      window.clearTimeout(timerId);
    });
    timerIdsRef.current = [];
  }, []);

  useEffect(() => {
    return clearPendingPins;
  }, [clearPendingPins]);

  useEffect(() => {
    const newMessageCount = dataSourceLength - prevLengthRef.current;
    prevLengthRef.current = dataSourceLength;

    // Only scroll when user sends a new message (2 messages added: user + assistant pair)
    if (newMessageCount === 2 && isSecondLastMessageFromUser && scrollToIndex) {
      const userMessageIndex = dataSourceLength - 2;

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
    }
  }, [clearPendingPins, dataSourceLength, isSecondLastMessageFromUser, scrollToIndex]);
}
