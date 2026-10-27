import { useClientDataSWR } from '@/libs/swr';
import { mcpElicitationKeys } from '@/libs/swr/keys';
import { mcpElicitationService } from '@/services/mcpElicitation';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { useConversationStore } from '../store';

export function useFetchMcpElicitations() {
  const userId = useUserStore(userProfileSelectors.userId);
  const topicId = useConversationStore((s) => s.context.topicId);
  const threadId = useConversationStore((s) => s.context.threadId);
  return useClientDataSWR(
    topicId && userId ? mcpElicitationKeys.pending(userId, topicId, threadId) : null,
    () => mcpElicitationService.pending(topicId!, threadId),
    { dedupingInterval: 800, refreshInterval: 1000 },
  );
}
