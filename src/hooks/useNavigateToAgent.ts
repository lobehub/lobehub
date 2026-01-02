import { INBOX_SESSION_ID, SESSION_CHAT_URL } from '@lobechat/const';
import { useCallback } from 'react';

import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';

export const useNavigateToAgent = () => {
  const togglePortal = useChatStore((s) => s.togglePortal);
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const router = useQueryRoute();

  return useCallback(
    (agentId: string) => {
      const resolvedAgentId =
        agentId === INBOX_SESSION_ID && inboxAgentId ? inboxAgentId : agentId;

      togglePortal(false);

      router.push(SESSION_CHAT_URL(resolvedAgentId, false));
    },
    [togglePortal, router, inboxAgentId],
  );
};
