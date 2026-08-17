import { useAcceptanceBundle, useAcceptanceBySubject } from '@/features/Verify';
import { useTaskStore } from '@/store/task';

import { getGoalWorkProgress } from './goalWorkProgress';

interface GoalWorkStatusInput {
  criteriaCount?: number;
  goalKnown?: boolean;
  identifier?: string;
  maxRounds?: number;
  taskId?: string;
}

/**
 * Live Goal status for one task pointer (identifier + taskId): task detail +
 * acceptance aggregate → phase / round / checks coverage. Shared by the
 * running tracker card and the merged task-callback header — both only hold
 * the pointer, so everything else is fetched here. Callback cards wait for
 * task detail to classify the task before starting acceptance polling.
 */
export const useGoalWorkStatus = ({
  criteriaCount = 0,
  goalKnown = false,
  identifier,
  maxRounds,
  taskId,
}: GoalWorkStatusInput) => {
  const useFetchTaskDetail = useTaskStore((s) => s.useFetchTaskDetail);
  useFetchTaskDetail(identifier);
  const task = useTaskStore((s) => (identifier ? s.taskDetailMap[identifier] : undefined));
  const isGoal = goalKnown || !!task?.goal;
  const { data: acceptance } = useAcceptanceBySubject('task', isGoal ? (taskId ?? null) : null);
  const { data: bundle } = useAcceptanceBundle(acceptance?.id ?? null);

  const progress = getGoalWorkProgress({
    acceptanceStatus: acceptance?.status,
    checks: bundle?.checks,
    criteriaCount,
    maxRounds: task?.goal?.maxRounds ?? maxRounds,
    rounds: task?.topicCount ?? 0,
    taskStatus: task?.status,
  });

  return {
    isGoal,
    progress,
    startedAt: task?.startedAt,
    taskName: task?.name ?? undefined,
  };
};
