import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

/** Leave the reply popover before opening the Agent that owns the reply. */
export const useOpenReplyAgent = (agentId: string | null | undefined, close: () => void) => {
  const navigate = useWorkspaceAwareNavigate();

  return () => {
    if (!agentId) return;
    close();
    navigate(`/agent/${agentId}/profile`);
  };
};
