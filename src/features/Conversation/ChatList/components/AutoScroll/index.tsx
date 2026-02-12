'use client';

import { memo, useEffect } from 'react';

import {
  dataSelectors,
  messageStateSelectors,
  useConversationStore,
  virtuaListSelectors,
} from '../../../store';
import { useAutoScrollEnabled } from './useAutoScrollEnabled';

/**
 * AutoScroll component - handles auto-scrolling logic during AI generation.
 * Should be placed inside the last item of VList so it only triggers when visible.
 *
 * This component has no visual output - it only contains the auto-scroll logic.
 * Debug UI and BackBottom button are rendered separately outside VList.
 */
const AutoScroll = memo(() => {
  const atBottom = useConversationStore(virtuaListSelectors.atBottom);
  const isScrolling = useConversationStore(virtuaListSelectors.isScrolling);
  const isGenerating = useConversationStore(messageStateSelectors.isAIGenerating);
  const scrollToBottom = useConversationStore((s) => s.scrollToBottom);
  const dbMessages = useConversationStore(dataSelectors.dbMessages);
  const isAutoScrollEnabled = useAutoScrollEnabled();

  const shouldAutoScroll = isAutoScrollEnabled && atBottom && isGenerating && !isScrolling;

  // 获取最后一条消息的 content 长度，用于监听流式输出
  const lastMessage = dbMessages.at(-1);
  const lastMessageContentLength =
    typeof lastMessage?.content === 'string' ? lastMessage.content.length : 0;

  useEffect(() => {
    if (shouldAutoScroll) {
      scrollToBottom(false);
    }
  }, [shouldAutoScroll, scrollToBottom, dbMessages.length, lastMessageContentLength]);

  // No visual output - this component only handles auto-scroll logic
  return null;
});

AutoScroll.displayName = 'ConversationAutoScroll';

export default AutoScroll;
