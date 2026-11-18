import { useCallback } from 'react';

import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import type { TopicShareVisibility } from '@/store/chat/slices/topic/projection';

export type ShareVisibility = TopicShareVisibility;

/**
 * Share record of a topic, from the topic share replica. A topic without a
 * record is private: the record is created on the first visibility change
 * rather than when the share UI opens, so opening it never waits on a write.
 * A persisted record paints at once while the server confirms it.
 */
export const useTopicShare = (topicId: string | undefined, enabled: boolean) => {
  const { error, revalidate } = useChatStore((s) => s.useFetchTopicShare)(topicId, enabled);
  const entry = useChatStore(topicSelectors.getTopicShare(enabled ? topicId : undefined));
  const setTopicShareVisibility = useChatStore((s) => s.setTopicShareVisibility);

  /** Resolves to the share id after the change. */
  const setVisibility = useCallback(
    async (visibility: ShareVisibility) => {
      if (!topicId) return;
      return setTopicShareVisibility(topicId, visibility);
    },
    [setTopicShareVisibility, topicId],
  );

  const shareInfo = entry?.share ?? undefined;

  return {
    // A failed refresh keeps the record on screen; only a first load surfaces it.
    error: entry ? undefined : error,
    isLoading: !!topicId && enabled && !entry && !error,
    retry: revalidate,
    setVisibility,
    shareInfo,
    visibility: (shareInfo?.visibility as ShareVisibility) || 'private',
  };
};
