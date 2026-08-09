import { useAcceptanceBundle, useAcceptanceBySubject } from '@/features/Verify';
import { useTaskStore } from '@/store/task';

import { getGoalWorkProgress } from './goalWorkProgress';

interface GoalWorkStatusInput {
  criteriaCount?: number;
  identifier?: string;
  maxRounds?: number;
  taskId?: string;
}

/**
 * Live Goal status for one task pointer (identifier + taskId): task detail +
 * acceptance aggregate → phase / round / checks coverage. Shared by the
 * running tracker card and the merged task-callback header — both only hold
 * the pointer, so everything else is fetched here. Both fetchers no-op when
 * the ids are absent.
 */
export const useGoalWorkStatus = ({
  criteriaCount = 0,
  identifier,
  maxRounds,
  taskId,
}: GoalWorkStatusInput) => {
  const useFetchTaskDetail = useTaskStore((s) => s.useFetchTaskDetail);
  useFetchTaskDetail(identifier);
  const task = useTaskStore((s) => (identifier ? s.taskDetailMap[identifier] : undefined));
  const { data: acceptance } = useAcceptanceBySubject('task', taskId ?? null);
  const { data: bundle } = useAcceptanceBundle(acceptance?.id ?? null);
  const config = task?.config as { goal?: { maxIterations?: number | null } } | undefined;

  const progress = getGoalWorkProgress({
    acceptanceStatus: acceptance?.status,
    checks: bundle?.checks,
    criteriaCount,
    maxRounds: config?.goal?.maxIterations ?? maxRounds,
    rounds: task?.topicCount ?? 0,
    taskStatus: task?.status,
  });

  return { hasAcceptance: !!acceptance, progress, taskName: task?.name ?? undefined };
};
