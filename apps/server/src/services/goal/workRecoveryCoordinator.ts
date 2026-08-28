import type { GoalItem, TaskItem } from '@lobechat/types';
import debug from 'debug';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { TaskModel } from '@/database/models/task';
import type { LobeChatDatabase } from '@/database/type';
import { TaskRunnerService } from '@/server/services/taskRunner';

import { resolveWorkAttemptBudget, resolveWorkMaxSteps } from './recoveryPolicy';

const log = debug('lobe-server:goal-work-recovery');

export type WorkRecoveryOutcome =
  'continued' | 'exhausted-cost' | 'exhausted-rounds' | 'spawn-failed';

/** Retry budget and spawn boundary for a Goal Graph Work Task. */
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
  }): Promise<WorkRecoveryOutcome> => {
    const { goal, task } = params;
    const attempts = task.totalTopics || 0;
    const attemptBudget = resolveWorkAttemptBudget(goal);
    if (attempts >= attemptBudget) return 'exhausted-rounds';

    if (typeof goal.maxTotalCost === 'number') {
      const spent =
        params.spentCost ??
        (await new AgentOperationModel(this.db, this.userId, this.workspaceId).sumCostByTask(
          task.id,
        ));
      if (spent >= goal.maxTotalCost) return 'exhausted-cost';
    }

    // Both recovery paths — a failed verification and an abandoned operation —
    // reach here from `tick`, and advances overlap: an event hook, a manual
    // nudge, the sweep. `runTask` decides whether a run is in flight by reading
    // the task's topics before creating one, so without this claim two
    // coordinators would each spawn a paid retry of the same Work.
    //
    // Both paths hand us a task row read before they paused it, so the claim
    // has to compare against what the row says now. A task already `running`
    // is one another advance has claimed — leave it to that one.
    const taskModel = new TaskModel(this.db, this.userId, this.workspaceId);
    const current = await taskModel.findById(task.id);
    if (!current || current.status === 'running') {
      log('task %s recovery was already claimed by another advance', task.identifier);
      return 'continued';
    }
    const claimed = await taskModel.updateStatusIfCurrent(task.id, current.status, 'running', {
      error: null,
      startedAt: new Date(),
    });
    if (!claimed) {
      log('task %s recovery lost the claim race', task.identifier);
      return 'continued';
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
      // We own the claim, so nothing else will put the task back.
      await taskModel
        .updateStatusIfCurrent(task.id, 'running', current.status, { error: current.error })
        .catch((releaseError) => {
          log('task %s failed to release the recovery claim: %O', task.identifier, releaseError);
        });
      return 'spawn-failed';
    }
  };
}
