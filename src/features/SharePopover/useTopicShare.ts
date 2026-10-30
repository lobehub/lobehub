import { useCallback } from 'react';
import useSWR from 'swr';

import { shareKeys } from '@/libs/swr/keys';
import { topicService } from '@/services/topic';

export type ShareVisibility = 'private' | 'link';

/**
 * Share record of a topic. A topic without a record is private: the record is
 * created on the first visibility change rather than when the share UI opens,
 * so opening it never waits on a write.
 */
export const useTopicShare = (topicId: string | undefined, enabled: boolean) => {
  const { data, error, isLoading, mutate } = useSWR(
    topicId && enabled ? shareKeys.topicInfo(topicId) : null,
    () => topicService.getShareInfo(topicId!),
    { revalidateOnFocus: false },
  );

  /** Resolves to the share id after the change. */
  const setVisibility = useCallback(
    async (visibility: ShareVisibility) => {
      if (!topicId) return;

      let record = data
        ? await topicService.updateShareVisibility(topicId, visibility)
        : await topicService.enableSharing(topicId, visibility);
      // A stale cache can miss a record created elsewhere; create then keeps
      // the existing visibility, so apply the requested one on top.
      if (record && record.visibility !== visibility)
        record = await topicService.updateShareVisibility(topicId, visibility);

      await mutate();
      return record?.id ?? data?.id;
    },
    [data, mutate, topicId],
  );

  return {
    error,
    isLoading,
    retry: mutate,
    setVisibility,
    shareInfo: data,
    visibility: (data?.visibility as ShareVisibility) || 'private',
  };
};
