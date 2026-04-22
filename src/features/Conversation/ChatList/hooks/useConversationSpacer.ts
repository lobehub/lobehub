import { type AssistantContentBlock, type UIChatMessage } from '@lobechat/types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { dataSelectors, messageStateSelectors, useConversationStore } from '../../store';

export const CONVERSATION_SPACER_ID = '__conversation_spacer__';
export const CONVERSATION_SPACER_TRANSITION_MS = 200;

export const calculateConversationSpacerHeight = (
  viewportHeight: number,
  userHeight: number,
  assistantHeight: number,
) => Math.max(Math.round(viewportHeight - userHeight - assistantHeight), 0);

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

export const useConversationSpacer = (dataSource: string[]) => {
  const displayMessages = useConversationStore(dataSelectors.displayMessages);
  const isAIGenerating = useConversationStore(messageStateSelectors.isAIGenerating);
  const getItemOffset = useConversationStore((s) => s.virtuaScrollMethods?.getItemOffset);
  const getItemSize = useConversationStore((s) => s.virtuaScrollMethods?.getItemSize);
  const getViewportSize = useConversationStore((s) => s.virtuaScrollMethods?.getViewportSize);

  const [naturalHeight, setNaturalHeight] = useState(0);
  const [scrollReduction, setScrollReduction] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [spacerLayoutVersion, setSpacerLayoutVersion] = useState(0);

  const prevLengthRef = useRef(dataSource.length);
  const removeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const spacerObserverRef = useRef<ResizeObserver | null>(null);
  const userMessageIndexRef = useRef<number | null>(null);
  const assistantMessageIndexRef = useRef<number | null>(null);

  // Refs for scroll-shrink feature (stable callback access)
  const mountedRef = useRef(false);
  mountedRef.current = mounted;
  const isAIGeneratingRef = useRef(isAIGenerating);
  isAIGeneratingRef.current = isAIGenerating;
  const prevScrollOffsetRef = useRef<number | null>(null);
  const scrollShrinkEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Derived rendered height: natural height minus user scroll reduction
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

  const cleanupObserver = useCallback(() => {
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
  }, []);

  const cleanupSpacerObserver = useCallback(() => {
    spacerObserverRef.current?.disconnect();
    spacerObserverRef.current = null;
  }, []);

  const scheduleUnmount = useCallback(() => {
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
      scheduleUnmount();
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
    scheduleUnmount,
  ]);

  // Reset prev scroll offset when generation state changes to avoid stale deltas
  useEffect(() => {
    prevScrollOffsetRef.current = null;
  }, [isAIGenerating]);

  // Stable scroll handler for shrinking spacer on scroll-up when not streaming
  const handleScrollOffset = useCallback((currentScrollOffset: number) => {
    const prevOffset = prevScrollOffsetRef.current;
    prevScrollOffsetRef.current = currentScrollOffset;

    if (!mountedRef.current || isAIGeneratingRef.current || prevOffset === null) return;

    const delta = currentScrollOffset - prevOffset;
    if (delta >= 0) return;

    setScrollReduction((prev) => prev + Math.abs(delta));

    if (scrollShrinkEndTimerRef.current) clearTimeout(scrollShrinkEndTimerRef.current);
    scrollShrinkEndTimerRef.current = setTimeout(() => {
      scrollShrinkEndTimerRef.current = null;
    }, 150);
  }, []);

  // Unmount when rendered height reaches zero via scroll reduction
  useEffect(() => {
    if (renderedHeight === 0 && mounted && scrollReduction > 0) {
      setMounted(false);
      setScrollReduction(0);
      prevScrollOffsetRef.current = null;
    }
  }, [renderedHeight, mounted, scrollReduction]);

  useEffect(() => {
    return () => {
      cleanupObserver();
      cleanupSpacerObserver();
      clearRemoveTimer();
      if (scrollShrinkEndTimerRef.current) clearTimeout(scrollShrinkEndTimerRef.current);
    };
  }, [cleanupObserver, cleanupSpacerObserver, clearRemoveTimer]);

  // Ref callback bound to this hook's own spacer node. Using a ref (rather than
  // a document-wide querySelector) scopes observation to the spacer owned by
  // this list instance — ConversationProvider supports multiple simultaneously
  // mounted lists, so a global selector could attach to another panel's spacer
  // and drive spacerLayoutVersion from unrelated layout changes.
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

  useEffect(() => {
    const newMessageCount = dataSource.length - prevLengthRef.current;
    prevLengthRef.current = dataSource.length;

    const userMessage = displayMessages.at(-2);
    const assistantMessage = displayMessages.at(-1);

    if (newMessageCount !== 2 || userMessage?.role !== 'user' || !assistantMessage) return;

    setScrollReduction(0);
    prevScrollOffsetRef.current = null;
    userMessageIndexRef.current = dataSource.length - 2;
    assistantMessageIndexRef.current = dataSource.length - 1;

    requestAnimationFrame(() => {
      updateSpacerHeight();
    });
  }, [dataSource.length, displayMessages, updateSpacerHeight]);

  useEffect(() => {
    const { assistantId, userId } = getTrackedMessages();

    cleanupObserver();

    if (!assistantId || !userId || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        updateSpacerHeight();
      });
    });

    resizeObserverRef.current = observer;

    const userEl = getMessageElement(userId);
    const assistantEl = getMessageElement(assistantId);

    if (userEl) observer.observe(userEl);
    if (assistantEl) observer.observe(assistantEl);

    requestAnimationFrame(() => {
      updateSpacerHeight();
    });

    return cleanupObserver;
  }, [cleanupObserver, getTrackedMessages, latestAssistantSignature, updateSpacerHeight]);

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
    handleScrollOffset,
    isSpacerMessage: (id: string) => id === CONVERSATION_SPACER_ID,
    listData,
    registerSpacerNode,
    scrollShrinking: isScrollShrinking,
    spacerActive: mounted,
    spacerHeight: renderedHeight,
    spacerLayoutVersion,
  };
};
