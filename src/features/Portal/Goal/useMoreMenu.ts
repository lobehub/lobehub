import { useConfirmDeleteGoal, useGoalShareUrl } from '@/features/AgentGoals/useGoalActions';
import { type PortalMoreMenuConfig } from '@/features/Portal/components/PortalMoreMenu/types';
import { usePermission } from '@/hooks/usePermission';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { goalSelectors, useGoalStore } from '@/store/goal';

export const useGoalMoreMenu = (): PortalMoreMenuConfig | undefined => {
  const goalId = useChatStore(chatPortalSelectors.goalPortalId);
  const goal = useGoalStore((s) => goalSelectors.goalGraph(goalId)(s)?.goal);
  const refreshGoalGraph = useGoalStore((s) => s.refreshGoalGraph);
  const clearPortalStack = useChatStore((s) => s.clearPortalStack);
  const { allowed: canEdit } = usePermission('create_content');

  const agentId = goal?.agentId ?? undefined;
  const shareUrl = useGoalShareUrl({ agentId, goalId: goalId ?? '' });
  // Deleting from the side panel keeps the user in their conversation — only
  // the panel showing the now-gone goal closes.
  const confirmDelete = useConfirmDeleteGoal({
    agentId,
    goalId: goalId ?? '',
    onDeleted: clearPortalStack,
    projectId: goal?.projectId,
  });

  if (!goalId || !goal) return;

  return {
    copyId: goalId,
    copyLink: shareUrl,
    delete: canEdit ? confirmDelete : undefined,
    refresh: () => refreshGoalGraph(goalId),
  };
};
