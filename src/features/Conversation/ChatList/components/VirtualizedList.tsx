'use client';

import isEqual from 'fast-deep-equal';
import { type ReactElement, type ReactNode } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { type VListHandle } from 'virtua';
import { VList } from 'virtua';
import { useShallow } from 'zustand/react/shallow';

import WideScreenContainer from '../../../WideScreenContainer';
import {
  dataSelectors,
  messageStateSelectors,
  useConversationStore,
  virtuaListSelectors,
} from '../../store';
import {
  CONVERSATION_SPACER_TRANSITION_MS,
  useConversationScroll,
} from '../hooks/useConversationScroll';
import { useSelectionMessageIds } from '../hooks/useSelectionMessageIds';
import AutoScroll from './AutoScroll';
import { AT_BOTTOM_THRESHOLD } from './AutoScroll/const';
import DebugInspector, { OPEN_DEV_INSPECTOR } from './AutoScroll/DebugInspector';
import { useAutoScrollEnabled } from './AutoScroll/useAutoScrollEnabled';
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
  const didInitialScrollRef = useRef(false);
  const scrollEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Second-to-last message is the user turn when sending (user + assistant pair)
  const isSecondLastMessageFromUser = useConversationStore(
    dataSelectors.isSecondLastMessageFromUser,
  );

  const {
    isScrollShrinking,
    isSpacerMessage,
    listData,
    onScrollOffset,
    registerSpacerNode,
    spacerActive,
    spacerHeight,
  } = useConversationScroll({
    dataSource,
    isSecondLastMessageFromUser,
    virtuaRef,
  });
  const isAutoScrollEnabled = useAutoScrollEnabled();

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
  }, []);

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

    // Shrink spacer on scroll up when not streaming
    const ref = virtuaRef.current;
    if (ref) {
      onScrollOffset(ref.scrollOffset);
    }

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
  }, [activeIndex, checkAtBottom, onScrollOffset, setActiveIndex, setScrollState]);

  const handleScrollEnd = useCallback(() => {
    setScrollState({ isScrolling: false });
  }, [setScrollState]);

  // Register scroll methods to store on mount
  useEffect(() => {
    const ref = virtuaRef.current;
    if (ref) {
      registerVirtuaScrollMethods({
        getItemOffset: (index) => ref.getItemOffset(index),
        getItemSize: (index) => ref.getItemSize(index),
        getScrollOffset: () => ref.scrollOffset,
        getScrollSize: () => ref.scrollSize,
        getViewportSize: () => ref.viewportSize,
        scrollTo: (offset) => ref.scrollTo(offset),
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

  // Keep currently-streaming items mounted so vlist recycling never triggers
  // Markdown animation replay when the user scrolls them back into view.
  const streamingIndices = useConversationStore(
    useShallow((s) => {
      const indices: number[] = [];
      for (let i = 0; i < dataSource.length; i++) {
        const id = dataSource[i];
        if (!id) continue;
        if (messageStateSelectors.isMessageGenerating(id)(s)) indices.push(i);
      }
      return indices;
    }),
  );

  // Also keep items that host the active text selection — unmounting a node
  // containing a Selection endpoint would silently drop the user's highlight.
  const selectionMessageIds = useSelectionMessageIds();

  const keepMountedIndices = useMemo(() => {
    if (selectionMessageIds.size === 0) return streamingIndices;
    const merged = new Set<number>(streamingIndices);
    for (let i = 0; i < dataSource.length; i++) {
      const id = dataSource[i];
      if (id && selectionMessageIds.has(id)) merged.add(i);
    }
    if (merged.size === streamingIndices.length) return streamingIndices;
    return [...merged].sort((a, b) => a - b);
  }, [dataSource, streamingIndices, selectionMessageIds]);

  // Scroll to bottom on initial render
  useEffect(() => {
    if (didInitialScrollRef.current || !virtuaRef.current || dataSource.length === 0) return;

    virtuaRef.current.scrollToIndex(dataSource.length - 1, { align: 'end' });
    didInitialScrollRef.current = true;
  }, [dataSource.length]);

  const atBottom = useConversationStore(virtuaListSelectors.atBottom);
  const scrollToBottom = useConversationStore((s) => s.scrollToBottom);

  return (
    <div style={{ height: '100%', position: 'relative' }}>
      {/* Debug Inspector - placed outside VList so it won't be recycled by the virtual list */}
      {OPEN_DEV_INSPECTOR && <DebugInspector />}
      <VList
        bufferSize={typeof window !== 'undefined' ? window.innerHeight : 0}
        data={listData}
        keepMounted={keepMountedIndices}
        ref={virtuaRef}
        style={{ height: '100%', overflowAnchor: 'none', paddingBottom: 24 }}
        onScroll={handleScroll}
        onScrollEnd={handleScrollEnd}
      >
        {(messageId, index): ReactElement => {
          if (isSpacerMessage(messageId)) {
            // Only animate the collapse-to-zero (unmount). Any non-zero height
            // change (initial mount, shrink as assistant grows) is applied
            // instantly so virtua's scrollSize updates in a single frame and
            // scrollToIndex can reach the user message without trailing behind
            // a 200ms transition.
            const shouldAnimate = !isScrollShrinking && spacerHeight === 0;
            return (
              <WideScreenContainer key={messageId} style={{ position: 'relative' }}>
                <div
                  aria-hidden
                  ref={registerSpacerNode}
                  style={{
                    height: spacerHeight,
                    pointerEvents: 'none',
                    transition: shouldAnimate
                      ? `height ${CONVERSATION_SPACER_TRANSITION_MS}ms ease`
                      : 'none',
                    width: '100%',
                  }}
                />
              </WideScreenContainer>
            );
          }

          const isAgentCouncil = messageId.includes('agentCouncil');
          const isLastItem = index === dataSource.length - 1;
          const content = itemContent(index, messageId);

          if (isAgentCouncil) {
            // AgentCouncil needs full width for horizontal scroll
            return (
              <div key={messageId} style={{ position: 'relative', width: '100%' }}>
                {content}
                {/* AutoScroll is placed inside the last Item so it only triggers when the last Item is visible */}
                {isLastItem && isAutoScrollEnabled && !spacerActive && <AutoScroll />}
              </div>
            );
          }

          return (
            <WideScreenContainer key={messageId} style={{ position: 'relative' }}>
              {content}
              {isLastItem && isAutoScrollEnabled && !spacerActive && <AutoScroll />}
            </WideScreenContainer>
          );
        }}
      </VList>
      {/* BackBottom is placed outside VList so it remains visible regardless of scroll position */}
      <WideScreenContainer style={{ position: 'relative' }}>
        <BackBottom
          atBottom={atBottom}
          visible={!atBottom}
          onScrollToBottom={() => scrollToBottom(true)}
        />
      </WideScreenContainer>
    </div>
  );
}, isEqual);

VirtualizedList.displayName = 'ConversationVirtualizedList';

export default VirtualizedList;
