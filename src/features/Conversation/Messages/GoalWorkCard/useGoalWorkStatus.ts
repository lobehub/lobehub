import { goalSelectors, useGoalStore } from '@/store/goal';

import { getGoalWorkProgress } from './goalWorkProgress';

/**
 * Live Goal status for one `goals` row: the graph snapshot → phase and how much
 * of its Work is closed. The card only holds the goal id, so everything else is
 * fetched here.
 */
export const useGoalWorkStatus = ({
  criteriaCount = 0,
  goalId,
}: {
  criteriaCount?: number;
  goalId?: string;
}) => {
  const useFetchGoalGraph = useGoalStore((s) => s.useFetchGoalGraph);
  useFetchGoalGraph(goalId);
  const snapshot = useGoalStore(goalSelectors.goalGraph(goalId));

  const workNodes = snapshot?.nodes.filter((node) => node.kind === 'work') ?? [];

  return {
    agentId: snapshot?.goal.agentId ?? undefined,
    progress: getGoalWorkProgress({
      criteriaCount,
      pendingDecisions:
        snapshot?.decisions.filter((decision) => decision.status === 'pending').length ?? 0,
      status: snapshot?.goal.status,
      workDone: workNodes.filter((node) =>
        ['rejected', 'resolved', 'retired'].includes(node.status),
      ).length,
      workTotal: workNodes.length,
    }),
    startedAt: snapshot?.goal.startedAt ?? undefined,
    title: snapshot?.goal.title,
  };
};
