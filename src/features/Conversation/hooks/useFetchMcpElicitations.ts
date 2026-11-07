import { useEffect } from 'react';

import { useClientDataSWR } from '@/libs/swr';
import { mcpElicitationKeys } from '@/libs/swr/keys';
import { mcpElicitationService } from '@/services/mcpElicitation';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { useConversationStore } from '../store';
import { mcpActivityDeadline } from './mcpActivity';

export function useFetchMcpElicitations() {
  const userId = useUserStore(userProfileSelectors.userId);
  const topicId = useConversationStore((s) => s.context.topicId);
  const threadId = useConversationStore((s) => s.context.threadId);
  const deadline = useConversationStore((s) => mcpActivityDeadline(s.dbMessages));
  const response = useClientDataSWR(
    topicId && userId && deadline ? mcpElicitationKeys.pending(userId, topicId, threadId) : null,
    () => mcpElicitationService.pending(topicId!, threadId),
    {
      dedupingInterval: 2_000,
      refreshInterval: (data) =>
        Date.now() >= deadline ? 0 : data?.some((item) => item.resolving) ? 10_000 : 3_000,
      errorRetryCount: 3,
      errorRetryInterval: 5_000,
      refreshWhenHidden: false,
      refreshWhenOffline: false,
    },
  );
  // Cold local-process recovery is an explicit idempotent write; GET remains read-only.
  const resolvingIds =
    response.data
      ?.filter((item) => item.resolving)
      .map((item) => item.id)
      .join(',') ?? '';
  useEffect(() => {
    if (!resolvingIds) return;
    for (const itemId of resolvingIds.split(','))
      void mcpElicitationService.recover(itemId).catch(console.error);
  }, [resolvingIds]);
  return response;
}
