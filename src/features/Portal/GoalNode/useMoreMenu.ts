import { type PortalMoreMenuConfig } from '@/features/Portal/components/PortalMoreMenu/types';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { useGoalStore } from '@/store/goal';

export const useGoalNodeMoreMenu = (): PortalMoreMenuConfig | undefined => {
  const view = useChatStore(chatPortalSelectors.goalNodeView);
  const refreshGoalGraph = useGoalStore((s) => s.refreshGoalGraph);

  if (!view) return;
  const { goalId, nodeId } = view;

  return {
    copyId: nodeId,
    // Nodes are read out of the goal graph.
    refresh: () => refreshGoalGraph(goalId),
  };
};
