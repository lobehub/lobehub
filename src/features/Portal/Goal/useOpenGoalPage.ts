import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useChatStore } from '@/store/chat';
import { useGoalStore } from '@/store/goal';

/**
 * Leave the conversation for the goal's own page. The portal stack is this
 * conversation's inspection session, so it is cleared on the way out — the goal
 * page would otherwise open its panel on the same goal it already shows.
 */
export const useOpenGoalPage = (goalId?: string) => {
  const navigate = useWorkspaceAwareNavigate();
  const clearPortalStack = useChatStore((s) => s.clearPortalStack);
  const agentId = useGoalStore((s) =>
    goalId ? (s.goalGraphById[goalId]?.goal.agentId ?? undefined) : undefined,
  );

  if (!goalId) return undefined;

  return () => {
    clearPortalStack();
    navigate(agentId ? `/agent/${agentId}/goal/${goalId}` : `/goal/${goalId}`);
  };
};
