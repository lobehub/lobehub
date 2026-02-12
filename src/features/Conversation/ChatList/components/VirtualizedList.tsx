'use client';

import isEqual from 'fast-deep-equal';
import { type ReactElement, type ReactNode } from 'react';
import { memo, useCallback, useEffect, useRef } from 'react';
import { type VListHandle } from 'virtua';
import { VList } from 'virtua';

import WideScreenContainer from '../../../WideScreenContainer';
import { dataSelectors, useConversationStore, virtuaListSelectors } from '../../store';
import { useScrollToUserMessage } from '../hooks/useScrollToUserMessage';
import AutoScroll from './AutoScroll';
import { AT_BOTTOM_THRESHOLD } from './AutoScroll/const';
import DebugInspector, { OPEN_DEV_INSPECTOR } from './AutoScroll/DebugInspector';
import BackBottom from './BackBottom';

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

  // Get the second-to-last message to check if it's a user message
  // (When sending a message, user + assistant messages are created as a pair)
  const displayMessages = useConversationStore(dataSelectors.displayMessages);
  const secondLastMessage = displayMessages.at(-2);
  const isSecondLastMessageFromUser = secondLastMessage?.role === 'user';

  // Auto scroll to user message when user sends a new message
  // Only scroll when 2 new messages are added and second-to-last is from user
  useScrollToUserMessage({
    dataSourceLength: dataSource.length,
    isSecondLastMessageFromUser,
    scrollToIndex: virtuaRef.current?.scrollToIndex ?? null,
  });

  // Scroll to bottom on initial render
  useEffect(() => {
    if (virtuaRef.current && dataSource.length > 0) {
      virtuaRef.current.scrollToIndex(dataSource.length - 1, { align: 'end' });
    }
  }, []);

  const atBottom = useConversationStore(virtuaListSelectors.atBottom);
  const scrollToBottom = useConversationStore((s) => s.scrollToBottom);

  return (
    <div style={{ height: '100%', position: 'relative' }}>
      {/* Debug Inspector - 放在 VList 外面，不会被虚拟列表回收 */}
      {OPEN_DEV_INSPECTOR && <DebugInspector />}
      <VList
        bufferSize={typeof window !== 'undefined' ? window.innerHeight : 0}
        data={dataSource}
        ref={virtuaRef}
        style={{ height: '100%', overflowAnchor: 'none', paddingBottom: 24 }}
        onScroll={handleScroll}
        onScrollEnd={handleScrollEnd}
      >
        {(messageId, index): ReactElement => {
          const isAgentCouncil = messageId.includes('agentCouncil');
          const isLastItem = index === dataSource.length - 1;
          const content = itemContent(index, messageId);

          if (isAgentCouncil) {
            // AgentCouncil needs full width for horizontal scroll
            return (
              <div key={messageId} style={{ position: 'relative', width: '100%' }}>
                {content}
                {/* AutoScroll 放在最后一个 Item 里面，这样只有当最后一个 Item 可见时才会触发自动滚动 */}
                {isLastItem && <AutoScroll />}
              </div>
            );
          }

          return (
            <WideScreenContainer key={messageId} style={{ position: 'relative' }}>
              {content}
              {/* AutoScroll 放在最后一个 Item 里面，这样只有当最后一个 Item 可见时才会触发自动滚动 */}
              {isLastItem && <AutoScroll />}
            </WideScreenContainer>
          );
        }}
      </VList>
      {/* BackBottom 放在 VList 外面，这样无论滚动到哪里都能看到 */}
      <BackBottom
        atBottom={atBottom}
        visible={!atBottom}
        onScrollToBottom={() => scrollToBottom(true)}
      />
    </div>
  );
}, isEqual);

VirtualizedList.displayName = 'ConversationVirtualizedList';

export default VirtualizedList;
