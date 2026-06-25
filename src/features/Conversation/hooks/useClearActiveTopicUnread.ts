import { useEffect } from 'react';

import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/slices/operation/selectors';

/**
 * Clear a topic's persisted `unread` status once the user is actually reading it.
 *
 * `switchTopic` already clears unread for in-app navigation. This covers the
 * other entry points — reload, deep link, notification — where `ChatHydration`
 * sets `activeTopicId` directly (bypassing `switchTopic`) and the topic list may
 * not be loaded yet. We wait for the active topic to appear in a loaded bucket
 * as `unread`, then mark it read so the sidebar / home badge doesn't linger
 * while the user is already viewing it.
 *
 * `markTopicRead` is a no-op when the topic isn't unread, so it's safe to fire
 * whenever the derived unread state flips; it won't stomp a running / paused /
 * completed status, and clearing the status flips the trigger back to false so
 * the effect doesn't re-fire.
 */
export const useClearActiveTopicUnread = () => {
  const activeTopicId = useChatStore((s) => s.activeTopicId);
  const isActiveTopicUnread = useChatStore((s) =>
    activeTopicId ? operationSelectors.isTopicUnreadCompleted(activeTopicId)(s) : false,
  );
  const markTopicRead = useChatStore((s) => s.markTopicRead);

  useEffect(() => {
    if (activeTopicId && isActiveTopicUnread) markTopicRead({ topicId: activeTopicId });
  }, [activeTopicId, isActiveTopicUnread, markTopicRead]);
};
