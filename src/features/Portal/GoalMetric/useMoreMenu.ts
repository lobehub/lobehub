import { type PortalMoreMenuConfig } from '@/features/Portal/components/PortalMoreMenu/types';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { useGoalStore } from '@/store/goal';

export const useGoalMetricMoreMenu = (): PortalMoreMenuConfig | undefined => {
  const view = useChatStore(chatPortalSelectors.goalMetricView);
  const [refreshGoalGraph, refreshGoalMetricSeries] = useGoalStore((s) => [
    s.refreshGoalGraph,
    s.refreshGoalMetricSeries,
  ]);

  if (!view) return;
  const { goalId } = view;

  // A metric has no id or route of its own — it is a drill-down of its goal,
  // so the only thing to do here is re-read the goal and its time series.
  return {
    refresh: () => Promise.all([refreshGoalGraph(goalId), refreshGoalMetricSeries(goalId)]),
  };
};
