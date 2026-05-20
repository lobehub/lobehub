import debug from 'debug';
import isEqual from 'fast-deep-equal';
import { useCallback, useMemo } from 'react';

import { conversationSelectors, useConversationStore } from '@/features/Conversation';

import { type MinimapIndicator } from './types';
import { getIndicatorWidth, getPreviewText } from './utils';

const log = debug('lobe-react:chat-minimap');

export const useMinimapData = () => {
  const scrollMethods = useConversationStore(conversationSelectors.virtuaScrollMethods);
  const activeIndex = useConversationStore(conversationSelectors.activeIndex);
  const messages = useConversationStore(conversationSelectors.displayMessages, isEqual);

  const indicators = useMemo<MinimapIndicator[]>(() => {
    return messages.reduce<MinimapIndicator[]>((acc, message, virtuosoIndex) => {
      if (message.role !== 'user') return acc;

      acc.push({
        id: message.id,
        preview: getPreviewText(message.content),
        virtuosoIndex,
        width: getIndicatorWidth(message.content),
      });

      return acc;
    }, []);
  }, [messages]);

  const indicatorIndexMap = useMemo(() => {
    const map = new Map<number, number>();
    indicators.forEach(({ virtuosoIndex }, position) => {
      map.set(virtuosoIndex, position);
    });
    return map;
  }, [indicators]);

  const activeIndicatorPosition = useMemo(() => {
    if (activeIndex === null) return null;

    log('> activeIndex', activeIndex);
    log('> indicatorIndexMap', indicatorIndexMap);

    const exact = indicatorIndexMap.get(activeIndex);
    if (exact !== undefined) return exact;

    // Viewport sits on a non-user message (typically an assistant reply).
    // Highlight the most recent user message that started this turn.
    let matched: number | null = null;
    for (const [position, indicator] of indicators.entries()) {
      if (indicator.virtuosoIndex <= activeIndex) matched = position;
      else break;
    }
    return matched;
  }, [activeIndex, indicatorIndexMap, indicators]);

  const handleJump = useCallback(
    (virtIndex: number) => {
      scrollMethods?.scrollToIndex(virtIndex, { align: 'start', smooth: true });
    },
    [scrollMethods],
  );

  return {
    activeIndicatorPosition,
    handleJump,
    indicators,
  };
};
