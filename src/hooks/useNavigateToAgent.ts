import { SESSION_CHAT_URL } from '@lobechat/const';
import { useCallback } from 'react';

import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useChatStore } from '@/store/chat';

export const useNavigateToAgent = () => {
  const clearPortalStack = useChatStore((s) => s.clearPortalStack);
  const router = useQueryRoute();

  return useCallback(
    (agentId: string) => {
      clearPortalStack();

      router.push(SESSION_CHAT_URL(agentId, false));
    },
    [clearPortalStack, router],
  );
};
