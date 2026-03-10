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
      if (message.role !== 'user' && message.role !== 'assistant') return acc;

      acc.push({
        id: message.id,
        preview: getPreviewText(message.content),
        role: message.role,
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

    return indicatorIndexMap.get(activeIndex) ?? null;
  }, [activeIndex, indicatorIndexMap]);

  const handleJump = useCallback(
    (virtIndex: number) => {
      scrollMethods?.scrollToIndex(virtIndex, { align: 'start', smooth: true });
    },
    [scrollMethods],
  );

  const handleStep = useCallback(
    (direction: 'prev' | 'next') => {
      if (!scrollMethods || indicators.length === 0) return;

      let targetPosition: number;

      if (activeIndicatorPosition !== null) {
        log('activeIndicatorPosition', activeIndicatorPosition);
        // We're on an indicator, move to prev/next
        const delta = direction === 'prev' ? -1 : 1;
        targetPosition = Math.min(
          Math.max(activeIndicatorPosition + delta, 0),
          Math.max(indicators.length - 1, 0),
        );
      } else if (activeIndex !== null) {
        // We're not on an indicator, find the nearest one in the direction
        if (direction === 'prev') {
          let matched = -1;
          for (let pos = indicators.length - 1; pos >= 0; pos -= 1) {
            if (indicators[pos].virtuosoIndex < activeIndex) {
              matched = pos;
              break;
            }
          }
          targetPosition = matched === -1 ? 0 : matched;
        } else {
          let matched = indicators.length - 1;
          for (const [pos, indicator] of indicators.entries()) {
            if (indicator.virtuosoIndex > activeIndex) {
              matched = pos;
              break;
            }
          }
          targetPosition = matched;
        }
      } else {
        // No active index, go to first/last
        targetPosition = direction === 'prev' ? 0 : indicators.length - 1;
      }

      const targetIndicator = indicators[targetPosition];

      if (!targetIndicator) return;

      scrollMethods.scrollToIndex(targetIndicator.virtuosoIndex, { align: 'start', smooth: true });
    },
    [activeIndex, activeIndicatorPosition, indicators, scrollMethods],
  );

  return {
    activeIndicatorPosition,
    handleJump,
    handleStep,
    indicators,
  };
};
