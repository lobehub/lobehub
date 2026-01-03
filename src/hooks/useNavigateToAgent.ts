import { SESSION_CHAT_URL } from '@lobechat/const';
import { useCallback } from 'react';

import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useChatStore } from '@/store/chat';

export const useNavigateToAgent = () => {
  const togglePortal = useChatStore((s) => s.togglePortal);
  const router = useQueryRoute();

  return useCallback(
    (agentId: string) => {
      togglePortal(false);

      router.push(SESSION_CHAT_URL(agentId, false));
    },
    [togglePortal, router],
  );
};
