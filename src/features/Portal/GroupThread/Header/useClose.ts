import { useCallback } from 'react';

import { useAgentGroupStore } from '@/store/agentGroup';
import { useChatStore } from '@/store/chat';

/**
 * Closing the DM panel forgets which member it was with, then hands the close
 * to the host when it supplied one — otherwise the whole portal stack closes.
 */
export const useGroupThreadClose = (onClose?: () => void) => {
  const clearPortalStack = useChatStore((s) => s.clearPortalStack);

  return useCallback(() => {
    useAgentGroupStore.setState({ activeThreadAgentId: '' });
    (onClose ?? clearPortalStack)();
  }, [clearPortalStack, onClose]);
};
