import { goalSelectors, useGoalStore } from '@/store/goal';

import { getGoalTaskProgress, type GoalStep } from './goalTaskProgress';

/**
 * Live Goal status for one `goals` row: the graph snapshot → phase, the Tasks
 * as ordered steps, and how much of them is closed. The card only holds the
 * goal id, so everything else is fetched here.
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
  // The graph numbers Tasks in creation order; the step track must read the same.
  const steps: GoalStep[] = [...taskNodes]
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map((node) => ({ status: node.status, title: node.title }));

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
    steps,
    title: snapshot?.goal.title,
  };
};
