'use client';

import isEqual from 'fast-deep-equal';
import type {
  KeyboardEvent,
  PointerEvent,
  ReactElement,
  ReactNode,
  TouchEvent,
  WheelEvent,
} from 'react';
import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef } from 'react';
import type { VListHandle } from 'virtua';
import { VList } from 'virtua';
import { useShallow } from 'zustand/react/shallow';

import { useDevDockMounted } from '@/hooks/useDevDockMounted';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import WideScreenContainer from '../../../WideScreenContainer';
import { MessageForwardSelectToHere } from '../../MessageForward';
import {
  dataSelectors,
  inputSelectors,
  messageStateSelectors,
  useConversationStore,
  useConversationStoreApi,
  virtuaListSelectors,
} from '../../store';
import {
  CONVERSATION_SPACER_TRANSITION_MS,
  useConversationScroll,
} from '../hooks/useConversationScroll';
import { useEarlierHistoryTrigger } from '../hooks/useEarlierHistoryTrigger';
import { useSelectionMessageIds } from '../hooks/useSelectionMessageIds';
import { useTopicScrollPersist } from '../hooks/useTopicScrollPersist';
import { resolveAutoScrollDetached } from '../utils/autoScrollFollow';
import type { ResolvedMessageDeepLink } from '../utils/messageDeepLink';
import AutoScroll from './AutoScroll';
import { AT_BOTTOM_THRESHOLD } from './AutoScroll/const';
import { useAutoScrollEnabled } from './AutoScroll/useAutoScrollEnabled';
import BackBottom from './BackBottom';
import EarlierHistoryError from './EarlierHistoryError';
import EarlierHistorySkeleton from './EarlierHistorySkeleton';

const DebugInspector = lazy(() => import('./AutoScroll/DebugInspector'));

const CONVERSATION_FOOTER_ID = '__conversation_footer__';
const CONVERSATION_HEADER_ID = '__conversation_header__';
// One synthetic leading row always precedes the messages: it holds the
// header slot and, while a page of pre-window history is in flight, the
// conversation skeleton. Keeping it permanent matters because virtua keys
// rows by index — inserting a row on load start would shift every index
// and remount each message, dropping local UI state such as an expanded
// workflow fold. All index-based APIs exposed to the store (and the hooks
// that talk to virtua directly) work in MESSAGE index space; this offset
// translates at the virtua boundary.
const LEADING_ROWS = 1;
const VLIST_CLASS_NAME = 'conversation-vlist';
const USER_SCROLL_INTENT_TTL_MS = 500;
const SCROLL_KEYS = new Set(['ArrowDown', 'ArrowUp', 'End', 'Home', 'PageDown', 'PageUp', ' ']);

interface VirtualizedListProps {
  dataSource: string[];
  footerSlot?: ReactNode;
  headerSlot?: ReactNode;
  itemContent: (index: number, data: string) => ReactNode;
  messageDeepLink?: ResolvedMessageDeepLink;
}

/**
 * VirtualizedList for Conversation
 *
 * Based on ConversationStore data flow, no dependency on global ChatStore.
 */
const VirtualizedList = memo<VirtualizedListProps>(
  ({ dataSource, footerSlot, headerSlot, itemContent, messageDeepLink }) => {
    const virtuaRef = useRef<VListHandle>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const scrollEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastUserScrollIntentAtRef = useRef(0);
    // Plain clicks also mark `lastUserScrollIntentAtRef` (scrollbar track
    // clicks), but a click that collapses a block makes the browser correct the
    // offset upward — so detaching auto-scroll only trusts actual scroll input.
    const lastActiveScrollInputAtRef = useRef(0);
    const lastScrollOffsetRef = useRef<number | null>(null);

    // Per-topic scroll restoration. Provider does not remount on topic switch,
    // so we key the scroll snapshot by the message-map key derived from
    // ConversationStore's `context`.
    const contextKey = useConversationStore((s) => messageMapKey(s.context));
    const getScroller = useCallback(
      () =>
        containerRef.current?.querySelector<HTMLElement>(`:scope > .${VLIST_CLASS_NAME}`) ?? null,
      [],
    );
    const { recordScroll } = useTopicScrollPersist({
      contextKey,
      containerRef,
      dataSourceLength: dataSource.length,
      getScroller,
      headerOffset: LEADING_ROWS,
      messageDeepLink,
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
      contextKey,
      dataSource,
      headerOffset: LEADING_ROWS,
      isSecondLastMessageFromUser,
      virtuaRef,
    });

    const isAutoScrollEnabled = useAutoScrollEnabled();
    const devDockMounted = useDevDockMounted();

    // While multi-selecting, let message rows span the full stream width so the
    // clickable/highlight band fills the available space instead of the centered
    // reading column.
    const isSelectionMode = useConversationStore(messageStateSelectors.isSelectionMode);

    // Store actions
    const storeApi = useConversationStoreApi();
    const loadEarlierMessages = useConversationStore((s) => s.loadEarlierMessages);
    const registerVirtuaScrollMethods = useConversationStore((s) => s.registerVirtuaScrollMethods);
    const setScrollState = useConversationStore((s) => s.setScrollState);
    const scrollToBottom = useConversationStore((s) => s.scrollToBottom);
    const resetVisibleItems = useConversationStore((s) => s.resetVisibleItems);
    const setActiveIndex = useConversationStore((s) => s.setActiveIndex);
    const activeIndex = useConversationStore(virtuaListSelectors.activeIndex);

    const earlierHistory = useEarlierHistoryTrigger({ loadEarlierMessages, virtuaRef });

    const markUserScrollIntent = useCallback(() => {
      lastUserScrollIntentAtRef.current = Date.now();
    }, []);

    // `isScrolling` pauses streaming auto-scroll, so it tracks the user's own
    // scrolling only. Auto-scroll's jumps also fire scroll events; counting
    // them would hold the flag and throttle following to one jump per
    // scroll-end debounce, leaving the newest lines below the fold.
    const markUserScrolling = useCallback(() => {
      setScrollState({ isScrolling: true });
      if (scrollEndTimerRef.current) clearTimeout(scrollEndTimerRef.current);
      scrollEndTimerRef.current = setTimeout(() => {
        setScrollState({ isScrolling: false });
      }, 150);
    }, [setScrollState]);

    const markActiveScrollInput = useCallback(() => {
      const now = Date.now();
      lastUserScrollIntentAtRef.current = now;
      lastActiveScrollInputAtRef.current = now;
      // Mark before the resulting scroll event so a streaming chunk landing in
      // between cannot jump over the user's input.
      markUserScrolling();
    }, [markUserScrolling]);

    const handlePointerDown = useCallback(
      (event: PointerEvent<HTMLDivElement>) => {
        // A press on the scroller's own scrollbar (track click or drag start)
        // is scroll input; presses on message content are just clicks.
        const target = event.target as HTMLElement;
        const isScroller = target.clientWidth > 0 && target.scrollHeight > target.clientHeight;
        if (isScroller && event.nativeEvent.offsetX > target.clientWidth) {
          markActiveScrollInput();
        } else {
          markUserScrollIntent();
        }
      },
      [markActiveScrollInput, markUserScrollIntent],
    );

    const handlePointerMove = useCallback(
      (event: PointerEvent<HTMLDivElement>) => {
        if (event.buttons > 0) {
          markActiveScrollInput();
        }
      },
      [markActiveScrollInput],
    );

    const handleKeyDown = useCallback(
      (event: KeyboardEvent<HTMLDivElement>) => {
        if (SCROLL_KEYS.has(event.key)) {
          markActiveScrollInput();
        }
        earlierHistory.onKeyDown(event);
      },
      [earlierHistory, markActiveScrollInput],
    );

    const handleWheel = useCallback(
      (event: WheelEvent<HTMLDivElement>) => {
        markActiveScrollInput();
        earlierHistory.onWheel(event);
      },
      [earlierHistory, markActiveScrollInput],
    );

    const handleTouchMove = useCallback(
      (event: TouchEvent<HTMLDivElement>) => {
        markActiveScrollInput();
        earlierHistory.onTouchMove(event);
      },
      [earlierHistory, markActiveScrollInput],
    );

    const getDistanceToBottom = useCallback(() => {
      const ref = virtuaRef.current;
      if (!ref) return Infinity;

      return ref.scrollSize - ref.scrollOffset - ref.viewportSize;
    }, []);

    // Handle scroll events
    const handleScroll = useCallback(() => {
      const refForActive = virtuaRef.current;
      const activeFromFindRaw =
        refForActive && typeof refForActive.findItemIndex === 'function'
          ? refForActive.findItemIndex(refForActive.scrollOffset + refForActive.viewportSize * 0.25)
          : null;
      // findItemIndex returns a virtua row index — translate to message space
      // (the header row clamps to the first message).
      const activeFromFind =
        typeof activeFromFindRaw === 'number' && activeFromFindRaw >= 0
          ? Math.max(0, activeFromFindRaw - LEADING_ROWS)
          : null;

      if (activeFromFind !== activeIndex) setActiveIndex(activeFromFind);

      const hasUserScrollIntent =
        Date.now() - lastUserScrollIntentAtRef.current <= USER_SCROLL_INTENT_TTL_MS;
      if (hasUserScrollIntent) markUserScrolling();

      const distanceToBottom = getDistanceToBottom();
      const isAtBottom = distanceToBottom <= AT_BOTTOM_THRESHOLD;

      // Shrink spacer on scroll up when not streaming
      const ref = virtuaRef.current;
      if (ref) {
        onScrollOffset(ref.scrollOffset, hasUserScrollIntent);

        // Programmatic mount/restore scrolls carry no intent and never fetch.
        if (hasUserScrollIntent) earlierHistory.onUserScroll();

        const autoScrollDetached = resolveAutoScrollDetached({
          detached: storeApi.getState().autoScrollDetached,
          distanceToBottom,
          hasActiveScrollInput:
            Date.now() - lastActiveScrollInputAtRef.current <= USER_SCROLL_INTENT_TTL_MS,
          offset: ref.scrollOffset,
          prevOffset: lastScrollOffsetRef.current,
        });
        lastScrollOffsetRef.current = ref.scrollOffset;
        setScrollState({ atBottom: isAtBottom, autoScrollDetached });
      } else {
        setScrollState({ atBottom: isAtBottom });
      }

      if (ref) {
        recordScroll(ref.scrollOffset, isAtBottom);
      }
    }, [
      activeIndex,
      earlierHistory,
      getDistanceToBottom,
      markUserScrolling,
      onScrollOffset,
      recordScroll,
      setActiveIndex,
      setScrollState,
      storeApi,
    ]);

    // Sending a message is an explicit request to follow the new reply, so it
    // re-attaches auto-scroll even if the user had scrolled away earlier.
    // Keyed on the last id: loading earlier history prepends rows and leaves it
    // unchanged, so it must not count as a send.
    const lastMessageId = dataSource.at(-1);
    const prevLastMessageIdRef = useRef(lastMessageId);
    useEffect(() => {
      const lastChanged = lastMessageId !== prevLastMessageIdRef.current;
      prevLastMessageIdRef.current = lastMessageId;
      if (lastChanged && isSecondLastMessageFromUser) {
        setScrollState({ autoScrollDetached: false });
      }
    }, [isSecondLastMessageFromUser, lastMessageId, setScrollState]);

    // BackBottom is an explicit request to follow again. While streaming, a
    // smooth scroll aims at the bottom measured at click time and lands short
    // once the reply has grown, so jump instead and let auto-scroll take over.
    const handleBackBottom = useCallback(() => {
      setScrollState({ autoScrollDetached: false });
      scrollToBottom(!messageStateSelectors.isAIGenerating(storeApi.getState()));
    }, [scrollToBottom, setScrollState, storeApi]);

    const handleScrollEnd = useCallback(() => {
      setScrollState({ isScrolling: false });
    }, [setScrollState]);

    // Register scroll methods to store on mount
    useEffect(() => {
      const ref = virtuaRef.current;
      if (ref) {
        // Index-based methods accept MESSAGE indices; the header slot row is a
        // private implementation detail translated away right here.
        registerVirtuaScrollMethods({
          getItemOffset: (index) => ref.getItemOffset(index + LEADING_ROWS),
          getItemSize: (index) => ref.getItemSize(index + LEADING_ROWS),
          getScrollElement: getScroller,
          getScrollOffset: () => ref.scrollOffset,
          getScrollSize: () => ref.scrollSize,
          getTotalCount: () => totalCountRef.current,
          getViewportSize: () => ref.viewportSize,
          scrollTo: (offset) => ref.scrollTo(offset),
          scrollToEnd: () => {
            const scroller = getScroller();
            if (scroller) scroller.scrollTop = scroller.scrollHeight;
          },
          scrollToIndex: (index, options) => ref.scrollToIndex(index + LEADING_ROWS, options),
        });

        // Seed active index once on mount (avoid requiring user scroll)
        const initialActiveRaw = ref.findItemIndex(ref.scrollOffset + ref.viewportSize * 0.25);
        const initialActive =
          typeof initialActiveRaw === 'number' && initialActiveRaw >= 0
            ? Math.max(0, initialActiveRaw - LEADING_ROWS)
            : null;
        setActiveIndex(initialActive);
      }

      return () => {
        registerVirtuaScrollMethods(null);
      };
    }, [getScroller, registerVirtuaScrollMethods, setActiveIndex]);

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
          if (messageStateSelectors.isRowGenerating(id)(s)) indices.push(i);
        }
        return indices;
      }),
    );

    // Also keep items that host the active text selection — unmounting a node
    // containing a Selection endpoint would silently drop the user's highlight.
    const selectedNodeIds = useSelectionMessageIds();
    const selectionMessageIds = useConversationStore(
      useShallow((s) => new Set([...selectedNodeIds].map((id) => dataSelectors.hostRowOf(id)(s)))),
    );

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

    // The ChatInput's floating overlay (TodoProgress + QueueTray) covers the
    // bottom of this scroll viewport like a layer. Extend VList's internal
    // padding-bottom by the overlay height so the last message can still be
    // scrolled into view *above* the overlay; the +12 compensates for the
    // ChatInput's `marginTop: -12` (skipScrollMarginWithList) so the last
    // message lands exactly on the overlay's top edge.
    const overlayHeight = useConversationStore(inputSelectors.chatInputOverlayHeight);
    const paddingBottom = Math.max(24, overlayHeight + 12);

    const dataWithSlots = useMemo(
      () => [CONVERSATION_HEADER_ID, ...listData, ...(footerSlot ? [CONVERSATION_FOOTER_ID] : [])],
      [footerSlot, listData],
    );

    // Prepend detection for virtua: when pre-window history loads, the former
    // first message moves down the list. Passing `shift` for exactly that
    // render keeps the viewport anchored on the rows the user was reading
    // instead of snapping to the (new) top. Removals and topic switches drop
    // the previous first id from the list entirely and stay unshifted.
    const firstMessageId = listData[0] as string | undefined;
    const prevFirstMessageIdRef = useRef(firstMessageId);
    const prevFirstMessageId = prevFirstMessageIdRef.current;
    const shift =
      prevFirstMessageId !== undefined &&
      firstMessageId !== prevFirstMessageId &&
      listData.includes(prevFirstMessageId);
    useEffect(() => {
      prevFirstMessageIdRef.current = firstMessageId;
    });

    // The leading row is pinned: it is zero-height while idle, and virtua
    // excludes a zero-height row at the top from its render range, so it
    // would never mount to show the skeleton it hosts.
    const keepMountedIndicesWithSlots = useMemo(
      () => [0, ...keepMountedIndices.map((index) => index + LEADING_ROWS)],
      [keepMountedIndices],
    );

    // Mirror the latest data length into a ref so the scroll-methods registered
    // once on mount can read the current total count (including spacer/footer,
    // but excluding the leading header row — the count stays in the same
    // message-index space as the registered scrollToIndex) without
    // re-registering on every render.
    const totalCountRef = useRef(dataWithSlots.length - LEADING_ROWS);
    totalCountRef.current = dataWithSlots.length - LEADING_ROWS;

    return (
      <div
        ref={containerRef}
        style={{ height: '100%', position: 'relative' }}
        onKeyDownCapture={handleKeyDown}
        onPointerDownCapture={handlePointerDown}
        onPointerMoveCapture={handlePointerMove}
        onTouchMoveCapture={handleTouchMove}
        onTouchStartCapture={earlierHistory.onTouchStart}
        onWheelCapture={handleWheel}
      >
        {/* Pinned to the list viewport top; only renders while multi-selecting */}
        <MessageForwardSelectToHere />
        {/* Debug Inspector - placed outside VList so it won't be recycled by the virtual list */}
        {devDockMounted && (
          <Suspense fallback={null}>
            <DebugInspector />
          </Suspense>
        )}
        <VList
          bufferSize={typeof window !== 'undefined' ? window.innerHeight : 0}
          className={VLIST_CLASS_NAME}
          data={dataWithSlots}
          keepMounted={keepMountedIndicesWithSlots}
          ref={virtuaRef}
          shift={shift}
          style={{ height: '100%', overflowAnchor: 'none', paddingBottom }}
          onScroll={handleScroll}
          onScrollEnd={handleScrollEnd}
        >
          {(messageId, index): ReactElement => {
            if (messageId === CONVERSATION_HEADER_ID) {
              return (
                <WideScreenContainer key={messageId} style={{ position: 'relative' }}>
                  {headerSlot}
                  <EarlierHistorySkeleton />
                  <EarlierHistoryError />
                </WideScreenContainer>
              );
            }
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
            const messageIndex = index - LEADING_ROWS;
            const isLastItem = messageIndex === dataSource.length - 1;
            const content = itemContent(messageIndex, messageId);

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
              <WideScreenContainer
                fullWidth={isSelectionMode}
                key={messageId}
                style={{ position: 'relative' }}
              >
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
            onScrollToBottom={handleBackBottom}
          />
        </WideScreenContainer>
      </div>
    );
  },
  isEqual,
);

VirtualizedList.displayName = 'ConversationVirtualizedList';

export default VirtualizedList;
