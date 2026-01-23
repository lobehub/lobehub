'use client';

import isEqual from 'fast-deep-equal';
import { type ReactElement, type ReactNode, memo, useCallback, useEffect, useRef } from 'react';
import { VList, type VListHandle } from 'virtua';

import WideScreenContainer from '../../../WideScreenContainer';
import { useConversationStore, virtuaListSelectors } from '../../store';
import AutoScroll from './AutoScroll';
import DebugInspector, {
  AT_BOTTOM_THRESHOLD,
  OPEN_DEV_INSPECTOR,
} from './AutoScroll/DebugInspector';

interface VirtualizedListProps {
  dataSource: string[];
  itemContent: (index: number, data: string) => ReactNode;
}

/**
 * VirtualizedList for Conversation
 *
 * Based on ConversationStore data flow, no dependency on global ChatStore.
 */
const VirtualizedList = memo<VirtualizedListProps>(({ dataSource, itemContent }) => {
  const virtuaRef = useRef<VListHandle>(null);
  const prevDataLengthRef = useRef(dataSource.length);
  const scrollEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Store actions
  const registerVirtuaScrollMethods = useConversationStore((s) => s.registerVirtuaScrollMethods);
  const setScrollState = useConversationStore((s) => s.setScrollState);
  const resetVisibleItems = useConversationStore((s) => s.resetVisibleItems);
  const setActiveIndex = useConversationStore((s) => s.setActiveIndex);
  const activeIndex = useConversationStore(virtuaListSelectors.activeIndex);

  // Check if at bottom based on scroll position
  const checkAtBottom = useCallback(() => {
    const ref = virtuaRef.current;
    if (!ref) return false;

    const scrollOffset = ref.scrollOffset;
    const scrollSize = ref.scrollSize;
    const viewportSize = ref.viewportSize;

    return scrollSize - scrollOffset - viewportSize <= AT_BOTTOM_THRESHOLD;
  }, [AT_BOTTOM_THRESHOLD]);

  // Handle scroll events
  const handleScroll = useCallback(() => {
    const refForActive = virtuaRef.current;
    const activeFromFindRaw =
      refForActive && typeof refForActive.findItemIndex === 'function'
        ? refForActive.findItemIndex(refForActive.scrollOffset + refForActive.viewportSize * 0.25)
        : null;
    const activeFromFind =
      typeof activeFromFindRaw === 'number' && activeFromFindRaw >= 0 ? activeFromFindRaw : null;

    if (activeFromFind !== activeIndex) setActiveIndex(activeFromFind);

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
  }, [activeIndex, checkAtBottom, setActiveIndex, setScrollState]);

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

      // Seed active index once on mount (avoid requiring user scroll)
      const initialActiveRaw = ref.findItemIndex(ref.scrollOffset + ref.viewportSize * 0.25);
      const initialActive =
        typeof initialActiveRaw === 'number' && initialActiveRaw >= 0 ? initialActiveRaw : null;
      setActiveIndex(initialActive);
    }

    return () => {
      registerVirtuaScrollMethods(null);
    };
  }, [registerVirtuaScrollMethods, setActiveIndex]);

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
      {/* Debug Inspector - 放在 VList 外面，不会被虚拟列表回收 */}
      {OPEN_DEV_INSPECTOR && <DebugInspector />}
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
          const isLast = index === dataSource.length - 1;

          if (isAgentCouncil) {
            // AgentCouncil needs full width for horizontal scroll
            return (
              <div key={messageId} style={{ position: 'relative', width: '100%' }}>
                {content}
                {isLast && <AutoScroll />}
              </div>
            );
          }

          return (
            <WideScreenContainer key={messageId} style={{ position: 'relative' }}>
              {content}
              {isLast && <AutoScroll />}
            </WideScreenContainer>
          );
        }}
      </VList>
    </>
  );
}, isEqual);

VirtualizedList.displayName = 'ConversationVirtualizedList';

export default VirtualizedList;
