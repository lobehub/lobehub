import { type AssistantContentBlock, type UIChatMessage } from '@lobechat/types';
import debug from 'debug';
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type VListHandle } from 'virtua';

import { dataSelectors, messageStateSelectors, useConversationStore } from '../../store';

const log = debug('lobe:conversation:scroll');

export const CONVERSATION_SPACER_ID = '__conversation_spacer__';
export const CONVERSATION_SPACER_TRANSITION_MS = 200;

const SCROLL_SHRINK_END_DELAY_MS = 150;

// -------- pure helpers --------

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

// ---------------------------------------------------------------------------
// Sub-hook: spacer layout signal
// ---------------------------------------------------------------------------
//
// Watches the spacer DOM node with a scoped ResizeObserver. Every size change
// bumps `spacerLayoutVersion`, which the pin controller uses as "layout
// settled" beats to retry its scroll.
//
// A scoped observer (rather than a document-wide selector) is deliberate:
// ConversationProvider can mount several chat lists simultaneously, and a
// global selector would attach to another panel's spacer.
// ---------------------------------------------------------------------------
const useSpacerLayoutSignal = () => {
  const [spacerLayoutVersion, setSpacerLayoutVersion] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);

  const cleanup = useCallback(() => {
    observerRef.current?.disconnect();
    observerRef.current = null;
  }, []);

  const registerSpacerNode = useCallback(
    (node: HTMLElement | null) => {
      cleanup();

      if (!node || typeof ResizeObserver === 'undefined') return;

      const observer = new ResizeObserver(() => {
        setSpacerLayoutVersion((v) => v + 1);
      });
      observer.observe(node);
      observerRef.current = observer;
      setSpacerLayoutVersion((v) => v + 1);
    },
    [cleanup],
  );

  useEffect(() => cleanup, [cleanup]);

  return { registerSpacerNode, spacerLayoutVersion };
};

// ---------------------------------------------------------------------------
// Sub-hook: spacer height & mount lifecycle
// ---------------------------------------------------------------------------
//
// Owns the spacer's natural height, its mount/unmount timing, and the user-
// driven shrink reduction. Measures via virtua's item methods when available,
// falling back to DOM `getBoundingClientRect` otherwise.
//
// Also hosts the ResizeObserver for the tracked user/assistant messages so
// that spacer height stays in sync as those messages grow.
// ---------------------------------------------------------------------------
interface UseSpacerHeightArgs {
  assistantMessageIndex: number | null;
  dataSource: string[];
  getItemOffset: ((index: number) => number) | undefined;
  getItemSize: ((index: number) => number) | undefined;
  getViewportSize: (() => number) | undefined;
  latestAssistantSignature: string;
  userMessageIndex: number | null;
}

const useSpacerHeight = ({
  dataSource,
  getItemOffset,
  getItemSize,
  getViewportSize,
  latestAssistantSignature,
  userMessageIndex,
  assistantMessageIndex,
}: UseSpacerHeightArgs) => {
  const [naturalHeight, setNaturalHeight] = useState(0);
  const [scrollReduction, setScrollReduction] = useState(0);
  const [mounted, setMounted] = useState(false);

  const mountedRef = useRef(false);
  mountedRef.current = mounted;

  const removeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesObserverRef = useRef<ResizeObserver | null>(null);

  const renderedHeight = Math.max(naturalHeight - scrollReduction, 0);
  const isScrollShrinking = scrollReduction > 0;

  const getTrackedMessages = useCallback(() => {
    const userIndex = userMessageIndex;
    const assistantIndex = assistantMessageIndex;

    return {
      assistantId:
        assistantIndex !== null && assistantIndex >= 0 ? dataSource[assistantIndex] || null : null,
      assistantIndex,
      userId: userIndex !== null && userIndex >= 0 ? dataSource[userIndex] || null : null,
      userIndex,
    };
  }, [assistantMessageIndex, dataSource, userMessageIndex]);

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

  // Observe tracked message heights; keep spacer in sync while assistant grows.
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

  useEffect(() => {
    return () => {
      cleanupMessagesObserver();
      clearRemoveTimer();
    };
  }, [cleanupMessagesObserver, clearRemoveTimer]);

  return {
    isScrollShrinking,
    mounted,
    mountedRef,
    renderedHeight,
    setMounted,
    setScrollReduction,
    updateSpacerHeight,
  };
};

// ---------------------------------------------------------------------------
// Sub-hook: pin controller
// ---------------------------------------------------------------------------
//
// Owns the pin state machine. Pin is "we just sent a message and want the
// viewport anchored to the user turn until the spacer stops resizing or the
// user scrolls away."
//
// `scrollToPinned` reads `virtuaRef.current?.scrollToIndex` at call time, not
// during render — this avoids the race where a send effect ran before the
// ref was attached and silently dropped the scroll.
// ---------------------------------------------------------------------------
type PinState = { index: number; seenActive: boolean } | null;

const usePinController = ({ virtuaRef }: { virtuaRef: RefObject<VListHandle | null> }) => {
  const pinRef = useRef<PinState>(null);

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

  return { clearPin, pinRef, scrollToPinned };
};

// ---------------------------------------------------------------------------
// Sub-hook: scroll cancel + shrink
// ---------------------------------------------------------------------------
//
// Converts raw scrollOffset deltas into pin cancellation and spacer-shrink
// actions. Streaming vs. idle behavior is identical about canceling the pin;
// shrinking only happens after streaming has ended so the spacer doesn't
// fight the assistant's growth animation.
// ---------------------------------------------------------------------------
interface UseScrollShrinkArgs {
  clearPin: (reason: string) => void;
  getScrollOffset: (() => number) | undefined;
  isAIGenerating: boolean;
  isAIGeneratingRef: RefObject<boolean>;
  mountedRef: RefObject<boolean>;
  setScrollReduction: (updater: (prev: number) => number) => void;
}

const useScrollShrink = ({
  clearPin,
  getScrollOffset,
  isAIGenerating,
  isAIGeneratingRef,
  mountedRef,
  setScrollReduction,
}: UseScrollShrinkArgs) => {
  const prevScrollOffsetRef = useRef<number | null>(null);
  const scrollShrinkEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    [clearPin, isAIGeneratingRef, mountedRef, setScrollReduction],
  );

  // Seed prev offset on generation flip — avoids stale deltas across streaming boundaries.
  useEffect(() => {
    prevScrollOffsetRef.current = getScrollOffset?.() ?? null;
  }, [getScrollOffset, isAIGenerating]);

  useEffect(() => {
    return () => {
      if (scrollShrinkEndTimerRef.current) clearTimeout(scrollShrinkEndTimerRef.current);
    };
  }, []);

  return { onScrollOffset, prevScrollOffsetRef };
};

// ---------------------------------------------------------------------------
// Main hook
// ---------------------------------------------------------------------------
//
// Design notes:
//
// - A single `prevLengthRef` and a single send-detection effect replace the
//   two legacy hooks (`useConversationSpacer` + `useScrollToUserMessage`)
//   that each tracked length independently and could disagree across
//   renders, causing the "send but no scroll" regressions.
// - `virtuaRef` is passed through, not `scrollToIndex`, so the pin reads the
//   ref at call time — closing the race where the ref hadn't been attached.
// - Retries are layout-driven: each `spacerLayoutVersion` bump re-fires
//   `scrollToIndex` once. The old 0/32/96ms timer fan-out is gone.
// ---------------------------------------------------------------------------
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

  const isAIGeneratingRef = useRef(isAIGenerating);
  isAIGeneratingRef.current = isAIGenerating;

  // State (not ref) so that downstream memos / effects re-run when a new turn
  // is pinned. The pin indices are only set from the send-detection effect;
  // using state keeps the observer & signature in sync on the very next
  // render rather than waiting for an unrelated dep to change.
  const [userMessageIndex, setUserMessageIndex] = useState<number | null>(null);
  const [assistantMessageIndex, setAssistantMessageIndex] = useState<number | null>(null);
  const prevLengthRef = useRef(dataSource.length);

  const { registerSpacerNode, spacerLayoutVersion } = useSpacerLayoutSignal();

  const latestAssistantSignature = useMemo(() => {
    const assistantId =
      assistantMessageIndex !== null && assistantMessageIndex >= 0
        ? dataSource[assistantMessageIndex]
        : null;
    if (!assistantId) return '';
    const assistantMessage = displayMessages.find((message) => message.id === assistantId);
    return getRenderableTailSignature(assistantMessage);
  }, [assistantMessageIndex, dataSource, displayMessages]);

  const {
    isScrollShrinking,
    mounted,
    mountedRef,
    renderedHeight,
    setMounted,
    setScrollReduction,
    updateSpacerHeight,
  } = useSpacerHeight({
    assistantMessageIndex,
    dataSource,
    getItemOffset,
    getItemSize,
    getViewportSize,
    latestAssistantSignature,
    userMessageIndex,
  });

  const { clearPin, pinRef, scrollToPinned } = usePinController({ virtuaRef });

  const { onScrollOffset, prevScrollOffsetRef } = useScrollShrink({
    clearPin,
    getScrollOffset,
    isAIGenerating,
    isAIGeneratingRef,
    mountedRef,
    setScrollReduction,
  });

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

    setScrollReduction(() => 0);
    prevScrollOffsetRef.current = getScrollOffset?.() ?? null;
    setUserMessageIndex(userIndex);
    setAssistantMessageIndex(assistantIndex);
    pinRef.current = { index: userIndex, seenActive: mountedRef.current };

    // Scroll immediately. If virtuaRef isn't ready yet, the spacerLayoutVersion
    // bumps that follow mount+measurement will retry.
    scrollToPinned('send');

    requestAnimationFrame(() => {
      updateSpacerHeight();
    });
  }, [
    dataSource,
    displayMessages,
    getScrollOffset,
    isSecondLastMessageFromUser,
    mountedRef,
    pinRef,
    prevScrollOffsetRef,
    scrollToPinned,
    setScrollReduction,
    updateSpacerHeight,
  ]);

  // --- pin re-fire: every time spacer layout settles ---
  useEffect(() => {
    const pin = pinRef.current;
    if (!pin) return;

    if (mounted) {
      pin.seenActive = true;
    }

    // Once the spacer has been seen mounted and is now gone, the pin window
    // closes — either we've reached the target or the user scrolled away.
    if (pin.seenActive && !mounted) {
      clearPin('spacer unmounted after activation');
      return;
    }

    scrollToPinned('spacer layout settle');
  }, [clearPin, mounted, pinRef, scrollToPinned, spacerLayoutVersion]);

  // Collapse spacer to unmount once the user has shrunk it to zero.
  useEffect(() => {
    if (renderedHeight === 0 && mounted && isScrollShrinking) {
      setMounted(false);
      setScrollReduction(() => 0);
      prevScrollOffsetRef.current = null;
    }
  }, [
    isScrollShrinking,
    mounted,
    prevScrollOffsetRef,
    renderedHeight,
    setMounted,
    setScrollReduction,
  ]);

  // Recompute spacer height when generation state or tail signature flips.
  useEffect(() => {
    if (!mounted) return;

    requestAnimationFrame(() => {
      updateSpacerHeight();
    });
  }, [isAIGenerating, latestAssistantSignature, mounted, updateSpacerHeight]);

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
