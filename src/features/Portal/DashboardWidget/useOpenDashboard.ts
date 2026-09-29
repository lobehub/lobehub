import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useChatStore } from '@/store/chat';

/**
 * Leave the conversation for a home dashboard (or the dashboard list). The
 * portal stack is this conversation's inspection session, so it is cleared on
 * the way out.
 */
export const useOpenDashboard = () => {
  const navigate = useWorkspaceAwareNavigate();
  const clearPortalStack = useChatStore((s) => s.clearPortalStack);

  return (dashboardId?: string) => {
    clearPortalStack();
    navigate(dashboardId ? `/dashboard/${dashboardId}` : '/dashboard');
  };
};
