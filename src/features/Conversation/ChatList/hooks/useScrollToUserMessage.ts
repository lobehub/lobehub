import { useEffect, useRef } from 'react';

interface UseScrollToUserMessageOptions {
  /**
   * Current data source length (number of messages)
   */
  dataSourceLength: number;
  /**
   * Whether the last message is from the user
   */
  isLastMessageFromUser: boolean;
  /**
   * Function to scroll to a specific index
   */
  scrollToIndex:
    | ((index: number, options?: { align?: 'start' | 'center' | 'end'; smooth?: boolean }) => void)
    | null;
}

/**
 * Hook to handle scrolling to user message when user sends a new message.
 * Only triggers scroll when the new message is from the user, not when AI/agent responds.
 *
 * This ensures that in group chat scenarios, when multiple agents are responding,
 * the view doesn't jump around as each agent starts speaking.
 */
export function useScrollToUserMessage({
  dataSourceLength,
  isLastMessageFromUser,
  scrollToIndex,
}: UseScrollToUserMessageOptions): void {
  const prevLengthRef = useRef(dataSourceLength);

  useEffect(() => {
    const hasNewMessage = dataSourceLength > prevLengthRef.current;
    prevLengthRef.current = dataSourceLength;

    // Only scroll when user sends a new message
    if (hasNewMessage && isLastMessageFromUser && scrollToIndex) {
      // Scroll to the second-to-last message (user's message) with the start aligned
      scrollToIndex(dataSourceLength - 2, { align: 'start', smooth: true });
    }
  }, [dataSourceLength, isLastMessageFromUser, scrollToIndex]);
}
