import { useAgentGroupStore } from '@/store/agentGroup';
import { useChatStore } from '@/store/chat';

export const useEnable = () => useAgentGroupStore((s) => !!s.activeThreadAgentId);

export const onClose = () => {
  useAgentGroupStore.setState({ activeThreadAgentId: '' });
  useChatStore.getState().togglePortal(false);
};
