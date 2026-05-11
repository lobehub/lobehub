'use client';

import isEqual from 'fast-deep-equal';
import type { ReactElement, ReactNode } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import type { VListHandle } from 'virtua';
import { VList } from 'virtua';
import { useShallow } from 'zustand/react/shallow';

import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import WideScreenContainer from '../../../WideScreenContainer';
import {
  dataSelectors,
  inputSelectors,
  messageStateSelectors,
  useConversationStore,
  virtuaListSelectors,
} from '../../store';
import {
  CONVERSATION_SPACER_TRANSITION_MS,
  useConversationScroll,
} from '../hooks/useConversationScroll';
import { useSelectionMessageIds } from '../hooks/useSelectionMessageIds';
import { useTopicScrollPersist } from '../hooks/useTopicScrollPersist';
import AutoScroll from './AutoScroll';
import { AT_BOTTOM_THRESHOLD } from './AutoScroll/const';
import DebugInspector, { OPEN_DEV_INSPECTOR } from './AutoScroll/DebugInspector';
import { useAutoScrollEnabled } from './AutoScroll/useAutoScrollEnabled';
import BackBottom from './BackBottom';

const CONVERSATION_FOOTER_ID = '__conversation_footer__';

interface VirtualizedListProps {
  dataSource: string[];
  footerSlot?: ReactNode;
  itemContent: (index: number, data: string) => ReactNode;
}

/**
 * VirtualizedList for Conversation
 *
 * Based on ConversationStore data flow, no dependency on global ChatStore.
 */
const VirtualizedList = memo<VirtualizedListProps>(({ dataSource, footerSlot, itemContent }) => {
  const virtuaRef = useRef<VListHandle>(null);
  const scrollEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Per-topic scroll restoration. Provider does not remount on topic switch,
  // so we key the scroll snapshot by the message-map key derived from
  // ConversationStore's `context`.
  const contextKey = useConversationStore((s) => messageMapKey(s.context));
  const { recordScroll } = useTopicScrollPersist({
    contextKey,
    dataSourceLength: dataSource.length,
    virtuaRef,
  });

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

    if (ref) {
      recordScroll(ref.scrollOffset, isAtBottom);
    }

    // Clear existing timer
    if (scrollEndTimerRef.current) {
      clearTimeout(scrollEndTimerRef.current);
    }

    // Set new timer for scroll end
    scrollEndTimerRef.current = setTimeout(() => {
      setScrollState({ isScrolling: false });
    }, 150);
  }, [activeIndex, checkAtBottom, onScrollOffset, recordScroll, setActiveIndex, setScrollState]);

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
        getTotalCount: () => totalCountRef.current,
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

  const atBottom = useConversationStore(virtuaListSelectors.atBottom);
  const scrollToBottom = useConversationStore((s) => s.scrollToBottom);

  // The ChatInput's floating overlay (TodoProgress + QueueTray) covers the
  // bottom of this scroll viewport like a layer. Extend VList's internal
  // padding-bottom by the overlay height so the last message can still be
  // scrolled into view *above* the overlay; the +12 compensates for the
  // ChatInput's `marginTop: -12` (skipScrollMarginWithList) so the last
  // message lands exactly on the overlay's top edge.
  const overlayHeight = useConversationStore(inputSelectors.chatInputOverlayHeight);
  const paddingBottom = Math.max(24, overlayHeight + 12);

  const dataWithFooter = useMemo(
    () => (footerSlot ? [...listData, CONVERSATION_FOOTER_ID] : listData),
    [listData, footerSlot],
  );

  // Mirror the latest data length into a ref so the scroll-methods registered
  // once on mount can read the current total count (including spacer/footer)
  // without re-registering on every render.
  const totalCountRef = useRef(dataWithFooter.length);
  totalCountRef.current = dataWithFooter.length;

  return (
    <div style={{ height: '100%', position: 'relative' }}>
      {/* Debug Inspector - placed outside VList so it won't be recycled by the virtual list */}
      {OPEN_DEV_INSPECTOR && <DebugInspector />}
      <VList
        bufferSize={typeof window !== 'undefined' ? window.innerHeight : 0}
        data={dataWithFooter}
        keepMounted={keepMountedIndices}
        ref={virtuaRef}
        style={{ height: '100%', overflowAnchor: 'none', paddingBottom }}
        onScroll={handleScroll}
        onScrollEnd={handleScrollEnd}
      >
        {(messageId, index): ReactElement => {
          if (messageId === CONVERSATION_FOOTER_ID) {
            return (
              <WideScreenContainer key={messageId} style={{ position: 'relative' }}>
                {footerSlot}
              </WideScreenContainer>
            );
          }
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
          bottomOffset={overlayHeight}
          visible={!atBottom}
          onScrollToBottom={() => scrollToBottom(true)}
        />
      </WideScreenContainer>
    </div>
  );
}, isEqual);

VirtualizedList.displayName = 'ConversationVirtualizedList';

export default VirtualizedList;
