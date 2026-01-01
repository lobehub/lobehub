'use client';

import isEqual from 'fast-deep-equal';
import { type ReactElement, type ReactNode, memo, useCallback, useEffect, useRef } from 'react';
import { VList, type VListHandle } from 'virtua';

import WideScreenContainer from '../../../WideScreenContainer';
import { useConversationStore, virtuaListSelectors } from '../../store';
import AutoScroll from './AutoScroll';

interface VirtualizedListProps {
  dataSource: string[];
  /**
   * Whether AI is generating (for auto-scroll)
   */
  isGenerating?: boolean;
  itemContent: (index: number, data: string) => ReactNode;
}

/**
 * VirtualizedList for Conversation
 *
 * Based on ConversationStore data flow, no dependency on global ChatStore.
 */
const VirtualizedList = memo<VirtualizedListProps>(({ dataSource, itemContent, isGenerating }) => {
  const virtuaRef = useRef<VListHandle>(null);
  const prevDataLengthRef = useRef(dataSource.length);
  const scrollEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const atBottomThreshold = 200;

  // Store actions
  const registerVirtuaScrollMethods = useConversationStore((s) => s.registerVirtuaScrollMethods);
  const setScrollState = useConversationStore((s) => s.setScrollState);
  const resetVisibleItems = useConversationStore((s) => s.resetVisibleItems);
  const scrollToBottom = useConversationStore((s) => s.scrollToBottom);
  const atBottom = useConversationStore(virtuaListSelectors.atBottom);

  // Check if at bottom based on scroll position
  const checkAtBottom = useCallback(() => {
    const ref = virtuaRef.current;
    if (!ref) return false;

    const scrollOffset = ref.scrollOffset;
    const scrollSize = ref.scrollSize;
    const viewportSize = ref.viewportSize;

    return scrollSize - scrollOffset - viewportSize <= atBottomThreshold;
  }, [atBottomThreshold]);

  // Handle scroll events
  const handleScroll = useCallback(() => {
    setScrollState({ isScrolling: true });

    // Check if at bottom
    const isAtBottom = checkAtBottom();
    setScrollState({ atBottom: isAtBottom });

    // Clear existing timer
    if (scrollEndTimerRef.current) {
      clearTimeout(scrollEndTimerRef.current);
    }

    // Set new timer for scroll end
    scrollEndTimerRef.current = setTimeout(() => {
      setScrollState({ isScrolling: false });
    }, 150);
  }, [checkAtBottom, setScrollState]);

  const handleScrollEnd = useCallback(() => {
    setScrollState({ isScrolling: false });
  }, [setScrollState]);

  // Register scroll methods to store on mount
  useEffect(() => {
    const ref = virtuaRef.current;
    if (ref) {
      registerVirtuaScrollMethods({
        getScrollOffset: () => ref.scrollOffset,
        getScrollSize: () => ref.scrollSize,
        getViewportSize: () => ref.viewportSize,
        scrollToIndex: (index, options) => ref.scrollToIndex(index, options),
      });
    }

    return () => {
      registerVirtuaScrollMethods(null);
    };
  }, [registerVirtuaScrollMethods]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      resetVisibleItems();
      if (scrollEndTimerRef.current) {
        clearTimeout(scrollEndTimerRef.current);
      }
    };
  }, [resetVisibleItems]);

  // Auto scroll to bottom when new messages arrive
  useEffect(() => {
    const shouldScroll = dataSource.length > prevDataLengthRef.current;
    prevDataLengthRef.current = dataSource.length;

    if (shouldScroll && virtuaRef.current) {
      virtuaRef.current.scrollToIndex(dataSource.length - 2, { align: 'start', smooth: true });
    }
  }, [dataSource.length]);

  // Scroll to bottom on initial render
  useEffect(() => {
    if (virtuaRef.current && dataSource.length > 0) {
      virtuaRef.current.scrollToIndex(dataSource.length - 1, { align: 'end' });
    }
  }, []);

  return (
    <>
      <VList
        bufferSize={typeof window !== 'undefined' ? window.innerHeight : 0}
        data={dataSource}
        onScroll={handleScroll}
        onScrollEnd={handleScrollEnd}
        ref={virtuaRef}
        style={{ height: '100%', paddingBottom: 24 }}
      >
        {(messageId, index): ReactElement => {
          const isAgentCouncil = messageId.includes('agentCouncil');
          const content = itemContent(index, messageId);

          if (isAgentCouncil) {
            // AgentCouncil needs full width for horizontal scroll
            return (
              <div key={messageId} style={{ position: 'relative', width: '100%' }}>
                {content}
              </div>
            );
          }

          return (
            <WideScreenContainer key={messageId} style={{ position: 'relative' }}>
              {content}
            </WideScreenContainer>
          );
        }}
      </VList>
      <WideScreenContainer
        onChange={() => {
          if (!atBottom) return;
          setTimeout(() => scrollToBottom(true), 100);
        }}
        style={{
          position: 'relative',
        }}
      >
        <AutoScroll isGenerating={isGenerating} />
      </WideScreenContainer>
    </>
  );
}, isEqual);

VirtualizedList.displayName = 'ConversationVirtualizedList';

export default VirtualizedList;
