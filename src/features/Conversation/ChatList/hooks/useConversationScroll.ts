import { type AssistantContentBlock, type UIChatMessage } from '@lobechat/types';
import debug from 'debug';
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type VListHandle } from 'virtua';

import { dataSelectors, messageStateSelectors, useConversationStore } from '../../store';

const log = debug('lobe:conversation:scroll');

export const CONVERSATION_SPACER_ID = '__conversation_spacer__';
export const CONVERSATION_SPACER_TRANSITION_MS = 200;

const SCROLL_SHRINK_END_DELAY_MS = 150;

export const calculateConversationSpacerHeight = (
  viewportHeight: number,
  userHeight: number,
  assistantHeight: number,
) => Math.max(Math.round(viewportHeight - userHeight - assistantHeight), 0);

interface ConversationSpacerScrollEffectOptions {
  delta: number;
  hasPrevOffset: boolean;
  isAIGenerating: boolean;
  isMounted: boolean;
}

export const getConversationSpacerScrollEffect = ({
  delta,
  hasPrevOffset,
  isAIGenerating,
  isMounted,
}: ConversationSpacerScrollEffectOptions) => {
  const cancelPin = isMounted && hasPrevOffset && delta < 0;

  return {
    cancelPin,
    shrinkSpacer: cancelPin && !isAIGenerating,
  };
};

const getMessageElement = (messageId: string | null) => {
  if (!messageId) return null;

  return document.querySelector(`[data-message-id="${messageId}"]`) as HTMLElement | null;
};

const getMessageHeight = (messageId: string | null) => {
  return getMessageElement(messageId)?.getBoundingClientRect().height || 0;
};

const getRenderableTailSignature = (message: UIChatMessage | undefined) => {
  if (!message) return '';

  const tailBlock: AssistantContentBlock | UIChatMessage =
    message.children && message.children.length > 0 ? message.children.at(-1)! : message;

  const contentLength = tailBlock.content?.length || 0;
  const reasoningLength = tailBlock.reasoning?.content?.length || 0;
  const toolCount = tailBlock.tools?.length || 0;

  return `${contentLength}:${reasoningLength}:${toolCount}:${message.updatedAt || 0}`;
};

/**
 * Unified scroll controller for the conversation list. Owns:
 *
 * 1. Bottom spacer that reserves viewport height so the newest user message
 *    can pin to the top of the scrollport.
 * 2. "Pin" state machine that scrolls the user message to top on send and
 *    re-fires while the spacer is still settling (ResizeObserver versions).
 * 3. Shrink-on-scroll-up behavior so the user can reclaim the spacer area.
 *
 * Design notes:
 *
 * - Pin state is a single `{ index, seenActive }` ref, not two hooks with
 *   independent `prevLengthRef`s. Send detection happens once.
 * - `scrollToIndex` is dereffed through `virtuaRef.current` at call time —
 *   never captured. This avoids the race where `virtuaRef.current` is still
 *   null during the effect that detects a send.
 * - Retries are layout-driven, not time-driven: each `spacerLayoutVersion`
 *   bump triggers one `scrollToIndex`. Previous 0/32/96ms fixed delays are
 *   gone — they were brittle around slow measurement and caused pin waves to
 *   fight user scroll.
 */
export interface UseConversationScrollOptions {
  dataSource: string[];
  isSecondLastMessageFromUser: boolean;
  virtuaRef: RefObject<VListHandle | null>;
}

export interface UseConversationScrollResult {
  /**
   * True while the user is actively dragging the spacer shorter via scroll-up.
   * Consumers can use this to disable the spacer's height transition so it
   * follows the pointer 1:1 instead of animating.
   */
  isScrollShrinking: boolean;
  isSpacerMessage: (id: string) => boolean;
  listData: string[];
  onScrollOffset: (scrollOffset: number) => void;
  registerSpacerNode: (node: HTMLElement | null) => void;
  spacerActive: boolean;
  spacerHeight: number;
}

type PinState = { index: number; seenActive: boolean } | null;

export const useConversationScroll = ({
  dataSource,
  isSecondLastMessageFromUser,
  virtuaRef,
}: UseConversationScrollOptions): UseConversationScrollResult => {
  const displayMessages = useConversationStore(dataSelectors.displayMessages);
  const isAIGenerating = useConversationStore(messageStateSelectors.isAIGenerating);
  const getItemOffset = useConversationStore((s) => s.virtuaScrollMethods?.getItemOffset);
  const getItemSize = useConversationStore((s) => s.virtuaScrollMethods?.getItemSize);
  const getScrollOffset = useConversationStore((s) => s.virtuaScrollMethods?.getScrollOffset);
  const getViewportSize = useConversationStore((s) => s.virtuaScrollMethods?.getViewportSize);

  const [naturalHeight, setNaturalHeight] = useState(0);
  const [scrollReduction, setScrollReduction] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [spacerLayoutVersion, setSpacerLayoutVersion] = useState(0);

  const prevLengthRef = useRef(dataSource.length);
  const pinRef = useRef<PinState>(null);
  const removeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesObserverRef = useRef<ResizeObserver | null>(null);
  const spacerObserverRef = useRef<ResizeObserver | null>(null);
  const userMessageIndexRef = useRef<number | null>(null);
  const assistantMessageIndexRef = useRef<number | null>(null);

  const mountedRef = useRef(false);
  mountedRef.current = mounted;
  const isAIGeneratingRef = useRef(isAIGenerating);
  isAIGeneratingRef.current = isAIGenerating;
  const prevScrollOffsetRef = useRef<number | null>(null);
  const scrollShrinkEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const renderedHeight = Math.max(naturalHeight - scrollReduction, 0);
  const isScrollShrinking = scrollReduction > 0;

  const getTrackedMessages = useCallback(() => {
    const userIndex = userMessageIndexRef.current;
    const assistantIndex = assistantMessageIndexRef.current;

    return {
      assistantId:
        assistantIndex !== null && assistantIndex >= 0 ? dataSource[assistantIndex] || null : null,
      assistantIndex,
      userId: userIndex !== null && userIndex >= 0 ? dataSource[userIndex] || null : null,
      userIndex,
    };
  }, [dataSource]);

  const latestAssistantSignature = (() => {
    const { assistantId } = getTrackedMessages();
    if (!assistantId) return '';

    const assistantMessage = displayMessages.find((message) => message.id === assistantId);
    return getRenderableTailSignature(assistantMessage);
  })();

  const clearRemoveTimer = useCallback(() => {
    if (removeTimerRef.current) {
      clearTimeout(removeTimerRef.current);
      removeTimerRef.current = null;
    }
  }, []);

  const cleanupMessagesObserver = useCallback(() => {
    messagesObserverRef.current?.disconnect();
    messagesObserverRef.current = null;
  }, []);

  const cleanupSpacerObserver = useCallback(() => {
    spacerObserverRef.current?.disconnect();
    spacerObserverRef.current = null;
  }, []);

  const scheduleSpacerUnmount = useCallback(() => {
    clearRemoveTimer();

    removeTimerRef.current = setTimeout(() => {
      setMounted(false);
      removeTimerRef.current = null;
    }, CONVERSATION_SPACER_TRANSITION_MS);
  }, [clearRemoveTimer]);

  const updateSpacerHeight = useCallback(() => {
    clearRemoveTimer();
    const { assistantId, assistantIndex, userId, userIndex } = getTrackedMessages();
    const viewportHeight = getViewportSize?.() || window.innerHeight;

    let nextHeight: number;

    if (userIndex !== null && assistantIndex !== null && getItemOffset && getItemSize) {
      const userTop = getItemOffset(userIndex);
      const assistantBottom = getItemOffset(assistantIndex) + getItemSize(assistantIndex);

      nextHeight = Math.max(Math.round(viewportHeight - (assistantBottom - userTop)), 0);
    } else {
      const userHeight = getMessageHeight(userId);
      if (!userHeight) return;

      const assistantHeight = getMessageHeight(assistantId);

      nextHeight = calculateConversationSpacerHeight(viewportHeight, userHeight, assistantHeight);
    }

    if (nextHeight === 0) {
      setNaturalHeight(0);
      scheduleSpacerUnmount();
      return;
    }

    setMounted(true);
    setNaturalHeight(nextHeight);
  }, [
    clearRemoveTimer,
    getTrackedMessages,
    getItemOffset,
    getItemSize,
    getViewportSize,
    scheduleSpacerUnmount,
  ]);

  const scrollToPinned = useCallback(
    (reason: string) => {
      const pin = pinRef.current;
      if (!pin) return;

      const scrollToIndex = virtuaRef.current?.scrollToIndex;
      if (!scrollToIndex) {
        log('scrollToPinned skipped: virtua not ready (%s) index=%d', reason, pin.index);
        return;
      }

      log('scrollToPinned (%s) index=%d', reason, pin.index);
      scrollToIndex(pin.index, { align: 'start', smooth: true });
    },
    [virtuaRef],
  );

  const clearPin = useCallback((reason: string) => {
    if (!pinRef.current) return;
    log('clearPin (%s) index=%d', reason, pinRef.current.index);
    pinRef.current = null;
  }, []);

  // --- send detection: single source of truth ---
  useEffect(() => {
    const newMessageCount = dataSource.length - prevLengthRef.current;
    prevLengthRef.current = dataSource.length;

    if (newMessageCount !== 2 || !isSecondLastMessageFromUser) return;

    const userMessage = displayMessages.at(-2);
    const assistantMessage = displayMessages.at(-1);
    if (userMessage?.role !== 'user' || !assistantMessage) return;

    const userIndex = dataSource.length - 2;
    const assistantIndex = dataSource.length - 1;

    log('send detected userIndex=%d', userIndex);

    // reset per-turn state
    setScrollReduction(0);
    prevScrollOffsetRef.current = getScrollOffset?.() ?? null;
    userMessageIndexRef.current = userIndex;
    assistantMessageIndexRef.current = assistantIndex;
    pinRef.current = { index: userIndex, seenActive: mountedRef.current };

    // Scroll immediately. If virtuaRef isn't ready yet, subsequent
    // spacerLayoutVersion bumps (mount + measurement) will retry.
    scrollToPinned('send');

    requestAnimationFrame(() => {
      updateSpacerHeight();
    });
  }, [
    dataSource,
    displayMessages,
    getScrollOffset,
    isSecondLastMessageFromUser,
    scrollToPinned,
    updateSpacerHeight,
  ]);

  // --- pin re-fire: every time spacer layout settles ---
  useEffect(() => {
    const pin = pinRef.current;
    if (!pin) return;

    if (mounted) {
      pin.seenActive = true;
    }

    // After the spacer has been seen mounted and is now gone, the pin window
    // is closed — user has either scrolled away or we reached the target.
    if (pin.seenActive && !mounted) {
      clearPin('spacer unmounted after activation');
      return;
    }

    scrollToPinned('spacer layout settle');
  }, [clearPin, mounted, scrollToPinned, spacerLayoutVersion]);

  // --- onScroll: cancel pin + optionally shrink spacer ---
  const onScrollOffset = useCallback(
    (currentScrollOffset: number) => {
      const prevOffset = prevScrollOffsetRef.current;
      prevScrollOffsetRef.current = currentScrollOffset;

      const delta = prevOffset === null ? 0 : currentScrollOffset - prevOffset;
      const { cancelPin, shrinkSpacer } = getConversationSpacerScrollEffect({
        delta,
        hasPrevOffset: prevOffset !== null,
        isAIGenerating: isAIGeneratingRef.current,
        isMounted: mountedRef.current,
      });

      if (!cancelPin) return;

      clearPin('user scrolled up');

      if (!shrinkSpacer) return;

      setScrollReduction((prev) => prev + Math.abs(delta));

      if (scrollShrinkEndTimerRef.current) clearTimeout(scrollShrinkEndTimerRef.current);
      scrollShrinkEndTimerRef.current = setTimeout(() => {
        scrollShrinkEndTimerRef.current = null;
      }, SCROLL_SHRINK_END_DELAY_MS);
    },
    [clearPin],
  );

  // Reset prev scroll offset when generation state flips — avoids stale deltas.
  useEffect(() => {
    prevScrollOffsetRef.current = getScrollOffset?.() ?? null;
  }, [getScrollOffset, isAIGenerating]);

  // Unmount when rendered height reaches zero via scroll reduction.
  useEffect(() => {
    if (renderedHeight === 0 && mounted && scrollReduction > 0) {
      setMounted(false);
      setScrollReduction(0);
      prevScrollOffsetRef.current = null;
    }
  }, [renderedHeight, mounted, scrollReduction]);

  // Ref callback for the spacer DOM node. Scoped to this list instance
  // (ConversationProvider supports multiple mounted lists simultaneously).
  const registerSpacerNode = useCallback(
    (node: HTMLElement | null) => {
      cleanupSpacerObserver();

      if (!node || typeof ResizeObserver === 'undefined') return;

      const observer = new ResizeObserver(() => {
        setSpacerLayoutVersion((v) => v + 1);
      });
      observer.observe(node);
      spacerObserverRef.current = observer;
      setSpacerLayoutVersion((v) => v + 1);
    },
    [cleanupSpacerObserver],
  );

  // Observe tracked user/assistant messages for height changes.
  useEffect(() => {
    const { assistantId, userId } = getTrackedMessages();

    cleanupMessagesObserver();

    if (!assistantId || !userId || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        updateSpacerHeight();
      });
    });

    messagesObserverRef.current = observer;

    const userEl = getMessageElement(userId);
    const assistantEl = getMessageElement(assistantId);

    if (userEl) observer.observe(userEl);
    if (assistantEl) observer.observe(assistantEl);

    requestAnimationFrame(() => {
      updateSpacerHeight();
    });

    return cleanupMessagesObserver;
  }, [cleanupMessagesObserver, getTrackedMessages, latestAssistantSignature, updateSpacerHeight]);

  // Recompute spacer height on generation state flips.
  useEffect(() => {
    if (!mounted) return;

    requestAnimationFrame(() => {
      updateSpacerHeight();
    });
  }, [isAIGenerating, latestAssistantSignature, mounted, updateSpacerHeight]);

  useEffect(() => {
    return () => {
      cleanupMessagesObserver();
      cleanupSpacerObserver();
      clearRemoveTimer();
      if (scrollShrinkEndTimerRef.current) clearTimeout(scrollShrinkEndTimerRef.current);
    };
  }, [cleanupMessagesObserver, cleanupSpacerObserver, clearRemoveTimer]);

  const listData = useMemo(
    () => (mounted ? [...dataSource, CONVERSATION_SPACER_ID] : dataSource),
    [dataSource, mounted],
  );

  return {
    isScrollShrinking,
    isSpacerMessage: (id: string) => id === CONVERSATION_SPACER_ID,
    listData,
    onScrollOffset,
    registerSpacerNode,
    spacerActive: mounted,
    spacerHeight: renderedHeight,
  };
};
