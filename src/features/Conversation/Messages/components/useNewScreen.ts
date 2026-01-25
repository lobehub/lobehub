import debug from 'debug';
import { useEffect, useState } from 'react';

import { useConversationStore } from '../../store';

const log = debug('lobe-render:Conversation:newScreen');

/**
 * Extra padding if needed
 */
const EXTRA_PADDING = 0;

/**
 * Default user message height (fallback)
 */
const DEFAULT_USER_MESSAGE_HEIGHT = 200;

export const useNewScreen = ({
  isLatestItem,
  creating,
  messageId,
}: {
  creating?: boolean;
  isLatestItem?: boolean;
  messageId: string;
}) => {
  const [minHeight, setMinHeight] = useState<string | undefined>(undefined);
  const virtuaScrollMethods = useConversationStore((s) => s.virtuaScrollMethods);

  useEffect(() => {
    // Clear minHeight when no longer the latest item
    if (!isLatestItem) {
      setMinHeight(undefined);
      return;
    }

    // Only calculate and set minHeight when creating, preserve after creating ends
    if (!creating) {
      return;
    }

    // Find current message element by data-message-id
    const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
    // Find VList item container (has data-index attribute)
    const currentWrapper = messageEl?.closest('[data-index]') as HTMLElement | null;
    // Get current index
    const currentIndex = currentWrapper?.dataset.index;

    // Find previous VList item by data-index (avoid sibling not existing due to virtualization)
    const prevIndex = currentIndex ? Number(currentIndex) - 1 : -1;
    const prevWrapper =
      prevIndex >= 0 ? document.querySelector(`[data-index="${prevIndex}"]`) : null;
    // Get previous message's .message-wrapper
    const prevMessageEl = prevWrapper?.querySelector('.message-wrapper');

    // Get real viewport height from VList
    const viewportHeight = virtuaScrollMethods?.getViewportSize?.() || window.innerHeight;

    if (prevMessageEl) {
      const prevHeight = prevMessageEl.getBoundingClientRect().height;

      // Goal: userMessage at top, so assistantMinHeight = viewportHeight - userMessageHeight
      const calculatedHeight = viewportHeight - prevHeight - EXTRA_PADDING;

      log(
        'calculate minHeight: messageId=%s, index=%s, viewportHeight=%d, prevHeight=%d, result=%d',
        messageId,
        currentIndex,
        viewportHeight,
        prevHeight,
        calculatedHeight,
      );

      // Don't set minHeight if calculated height <= 0
      setMinHeight(calculatedHeight > 0 ? `${calculatedHeight}px` : undefined);
    } else {
      // Fallback: use default value
      const fallbackHeight = viewportHeight - DEFAULT_USER_MESSAGE_HEIGHT - EXTRA_PADDING;
      log(
        'fallback minHeight: messageId=%s, viewportHeight=%d, fallbackHeight=%d',
        messageId,
        viewportHeight,
        fallbackHeight,
      );
      // Don't set minHeight if calculated height <= 0
      setMinHeight(fallbackHeight > 0 ? `${fallbackHeight}px` : undefined);
    }
  }, [isLatestItem, creating, messageId, virtuaScrollMethods]);

  return { minHeight };
};
