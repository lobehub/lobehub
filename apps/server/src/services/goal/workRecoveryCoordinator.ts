import type { GoalItem, TaskItem } from '@lobechat/types';
import debug from 'debug';

import { AgentOperationModel } from '@/database/models/agentOperation';
import type { LobeChatDatabase } from '@/database/type';
import { TaskRunnerService } from '@/server/services/taskRunner';
import { resolveGoalRoundBudget } from '@/server/services/verify/goalBudget';

const log = debug('lobe-server:goal-work-recovery');
const DEFAULT_MAX_ATTEMPTS_PER_WORK = 3;

export type WorkRecoveryOutcome =
  'continued' | 'exhausted-cost' | 'exhausted-rounds' | 'spawn-failed';

export const resolveWorkAttemptBudget = (goal: GoalItem, taskCarried: boolean): number => {
  const configured = goal.config?.recovery?.maxAttemptsPerWork;
  if (typeof configured === 'number') return Math.max(1, configured);
  return taskCarried ? resolveGoalRoundBudget(goal) : DEFAULT_MAX_ATTEMPTS_PER_WORK;
};

export const resolveWorkMaxSteps = (goal: GoalItem): number | undefined => {
  const configured = goal.config?.recovery?.maxStepsPerRun;
  return typeof configured === 'number' && configured > 0 ? configured : undefined;
};

/** Shared retry budget and spawn boundary for task-carried goals and Goal Graph Work Tasks. */
export class WorkRecoveryCoordinator {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  recover = async (params: {
    goal: GoalItem;
    spentCost?: number;
    task: TaskItem;
    taskCarried: boolean;
  }): Promise<WorkRecoveryOutcome> => {
    const { goal, task, taskCarried } = params;
    const attempts = task.totalTopics || 0;
    const attemptBudget = resolveWorkAttemptBudget(goal, taskCarried);
    if (attempts >= attemptBudget) return 'exhausted-rounds';

    if (typeof goal.maxTotalCost === 'number') {
      const spent =
        params.spentCost ??
        (await new AgentOperationModel(this.db, this.userId, this.workspaceId).sumCostByTask(
          task.id,
        ));
      if (spent >= goal.maxTotalCost) return 'exhausted-cost';
    }

    try {
      await new TaskRunnerService(this.db, this.userId, this.workspaceId).runTask({
        maxSteps: resolveWorkMaxSteps(goal),
        taskId: task.id,
        trigger: 'goal',
      });
      log('task %s → recovery attempt %d spawned', task.identifier, attempts + 1);
      return 'continued';
    } catch (error) {
      log('task %s recovery spawn failed (non-fatal): %O', task.identifier, error);
      return 'spawn-failed';
    }
  };
}
