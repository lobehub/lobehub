import { getDashboardPath } from '@/features/Dashboard/utils/path';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useChatStore } from '@/store/chat';

/**
 * Leave the conversation for a dashboard — inside its project when it has one
 * — or the home dashboard list. The portal stack is this conversation's
 * inspection session, so it is cleared on the way out.
 */
export const useOpenDashboard = () => {
  const navigate = useWorkspaceAwareNavigate();
  const clearPortalStack = useChatStore((s) => s.clearPortalStack);

  return (dashboard?: { id: string; projectId?: string | null }) => {
    clearPortalStack();
    navigate(dashboard ? getDashboardPath(dashboard) : '/dashboard');
  };
};
