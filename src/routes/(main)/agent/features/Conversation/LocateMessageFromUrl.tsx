'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'react-router';

import { useConversationStore } from '@/features/Conversation';
import {
  highlightMessageWhenScrollSettles,
  resolveTopicCommentMessageLocation,
} from '@/features/Portal/TopicComments/messageLocator';
import { useChatStore } from '@/store/chat';
import { displayMessageSelectors } from '@/store/chat/selectors';

const PARAM = 'locate';

/**
 * `?locate=<messageId>` scrolls the opened topic to that message and flashes it — how a rule
 * learned in conversation links back to the turn that taught it. The param is consumed once the
 * messages are in, whether or not the message is among them, so a reload does not jump again.
 */
const LocateMessageFromUrl = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const messageId = searchParams.get(PARAM);
  const messagesInit = useConversationStore((s) => s.messagesInit);
  const [loaded, index, elementId, scrollToIndex] = useChatStore((s) => {
    const chats = displayMessageSelectors.mainDisplayChats(s);
    const location = resolveTopicCommentMessageLocation(chats, messageId);
    return [
      chats.length > 0,
      location?.index ?? -1,
      location?.elementId,
      s.mainConversationScrollToIndex,
    ] as const;
  });

  useEffect(() => {
    // The conversation store can report ready a beat before the display list fills.
    if (!messageId || !messagesInit || !loaded) return;
    // Found but the list has not mounted its scroller yet: wait for it.
    if (index >= 0 && !scrollToIndex) return;

    if (index >= 0 && elementId && scrollToIndex) {
      requestAnimationFrame(() => {
        scrollToIndex(index, { align: 'center', smooth: false });
        highlightMessageWhenScrollSettles(elementId);
      });
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(PARAM);
        return next;
      },
      { replace: true },
    );
  }, [elementId, index, loaded, messageId, messagesInit, scrollToIndex, setSearchParams]);

  return null;
};

export default LocateMessageFromUrl;
