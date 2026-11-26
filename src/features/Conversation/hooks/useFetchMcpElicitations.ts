import { useEffect } from 'react';

import { useCacheScope } from '@/libs/swr/useCacheScope';
import { mcpElicitationService, type PendingMcpElicitation } from '@/services/mcpElicitation';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { useConversationStore } from '../store';
import { pendingMcpInputs } from '../store/mcpProjection';
import { mcpActivityDeadline } from './mcpActivity';

export function useFetchMcpElicitations() {
  const userId = useUserStore(userProfileSelectors.userId);
  const scope = useCacheScope();
  const topicId = useConversationStore((s) => s.context.topicId);
  const threadId = useConversationStore((s) => s.context.threadId);
  const deadline = useConversationStore((s) => mcpActivityDeadline(s.dbMessages));
  const response = pendingMcpInputs.useReplica(
    topicId && userId && deadline ? { scope, topicId, threadId } : null,
    {
      dedupingInterval: 2_000,
      refreshInterval: (data?: PendingMcpElicitation[]) =>
        Date.now() >= deadline ? 0 : data?.some((item) => item.resolving) ? 10_000 : 3_000,
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
