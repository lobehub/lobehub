'use client';

import { memo, useEffect, useLayoutEffect } from 'react';

import {
  dataSelectors,
  messageStateSelectors,
  useConversationStore,
  useConversationStoreApi,
  virtuaListSelectors,
} from '../../../store';

/**
 * AutoScroll component - handles auto-scrolling logic during AI generation.
 * Should be placed inside the last item of VList so it only triggers when visible.
 *
 * This component has no visual output - it only contains the auto-scroll logic.
 * Debug UI and BackBottom button are rendered separately outside VList.
 */
const AutoScroll = memo(() => {
  const atBottom = useConversationStore(virtuaListSelectors.atBottom);
  const autoScrollDetached = useConversationStore(virtuaListSelectors.autoScrollDetached);
  const isScrolling = useConversationStore(virtuaListSelectors.isScrolling);
  const isGenerating = useConversationStore(messageStateSelectors.isAIGenerating);
  const scrollToBottom = useConversationStore((s) => s.scrollToBottom);
  const virtuaScrollMethods = useConversationStore((s) => s.virtuaScrollMethods);
  const storeApi = useConversationStoreApi();
  const dbMessages = useConversationStore(dataSelectors.dbMessages);

  const shouldAutoScroll = atBottom && !autoScrollDetached && isGenerating && !isScrolling;

  // Get the content length of the last message to monitor streaming output
  const lastMessage = dbMessages.at(-1);
  const lastMessageContentLength =
    typeof lastMessage?.content === 'string' ? lastMessage.content.length : 0;

  // Layout effect: the new chunk is already in the DOM, so jump before paint
  // instead of showing one frame with the newest lines below the fold.
  useLayoutEffect(() => {
    if (shouldAutoScroll) {
      scrollToBottom(false);
    }
  }, [shouldAutoScroll, scrollToBottom, dbMessages.length, lastMessageContentLength]);

  // Rows also grow outside the content-length change above (e.g. markdown
  // rendering a chunk in a later commit), and virtua only resizes the list
  // after measuring them. Follow every rendered row's growth before paint so
  // the newest lines never sit below the fold. Unlike virtua's own imperative
  // scroll, this stops as soon as the user scrolls away (`shouldAutoScroll`
  // turns false).
  useEffect(() => {
    if (!shouldAutoScroll) return;

    const content = virtuaScrollMethods?.getScrollElement()?.firstElementChild;
    if (!content) return;

    const observer = new ResizeObserver(() => {
      // The user may have started scrolling since this effect last ran.
      const { autoScrollDetached, isScrolling } = storeApi.getState();
      if (autoScrollDetached || isScrolling) return;
      scrollToBottom(false);
    });
    observer.observe(content);
    for (const row of content.children) observer.observe(row);
    return () => observer.disconnect();
  }, [shouldAutoScroll, scrollToBottom, storeApi, virtuaScrollMethods, dbMessages.length]);

  // No visual output - this component only handles auto-scroll logic
  return null;
});

AutoScroll.displayName = 'ConversationAutoScroll';

export default AutoScroll;
