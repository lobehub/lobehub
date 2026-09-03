import { goalSelectors, useGoalStore } from '@/store/goal';

import { getGoalTaskProgress } from './goalTaskProgress';

/**
 * Live Goal status for one `goals` row: the graph snapshot → phase and how much
 * of its Tasks are closed. The card only holds the goal id, so everything else is
 * fetched here.
 */
export const useGoalTaskStatus = ({
  criteriaCount = 0,
  goalId,
}: {
  criteriaCount?: number;
  goalId?: string;
}) => {
  const useFetchGoalGraph = useGoalStore((s) => s.useFetchGoalGraph);
  useFetchGoalGraph(goalId);
  const snapshot = useGoalStore(goalSelectors.goalGraph(goalId));

  const taskNodes = snapshot?.nodes.filter((node) => node.kind === 'task') ?? [];

  return {
    agentId: snapshot?.goal.agentId ?? undefined,
    progress: getGoalTaskProgress({
      criteriaCount,
      pendingDecisions:
        snapshot?.decisions.filter((decision) => decision.status === 'pending').length ?? 0,
      status: snapshot?.goal.status,
      taskDone: taskNodes.filter((node) =>
        ['rejected', 'resolved', 'retired'].includes(node.status),
      ).length,
      taskTotal: taskNodes.length,
    }),
    startedAt: snapshot?.goal.startedAt ?? undefined,
    title: snapshot?.goal.title,
  };
};
