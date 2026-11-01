import { type PortalMoreMenuConfig } from '@/features/Portal/components/PortalMoreMenu/types';
import { useAgentGroupStore } from '@/store/agentGroup';
import { useChatStore } from '@/store/chat';

export const useGroupThreadMoreMenu = (): PortalMoreMenuConfig | undefined => {
  const agentId = useAgentGroupStore((s) => s.activeThreadAgentId);
  const refreshMessages = useChatStore((s) => s.refreshMessages);

  if (!agentId) return;

  // The DM is a client-side filter of the group topic, not an entity of its
  // own: the member's agent id is its only handle, and refreshing re-reads the
  // group topic it is filtered from.
  return { copyId: agentId, refresh: () => refreshMessages() };
};
