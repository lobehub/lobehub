import type { GoalItem, TaskItem } from '@lobechat/types';
import debug from 'debug';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { TaskModel } from '@/database/models/task';
import type { LobeChatDatabase } from '@/database/type';
import { TaskRunnerService } from '@/server/services/taskRunner';

import { resolveTaskAttemptBudget, resolveTaskMaxSteps } from './recoveryPolicy';

const log = debug('lobe-server:goal-task-recovery');

export type TaskRecoveryOutcome =
  /** This call spawned the retry, and `operationId` is its run. */
  | 'started'
  /** Another overlapping advance owns the retry; this one started nothing. */
  | 'already-running'
  | 'exhausted-cost'
  | 'exhausted-rounds'
  | 'spawn-failed';

/**
 * `started` and `already-running` both mean "the Task is moving, keep waiting",
 * but only the first is something *this* advance did. They used to share the
 * name `continued`, which made the trajectory claim a run it had not started
 * and drop the operation id of the one it had.
 */
export interface TaskRecoveryResult {
  /** Present only on `started`. The drill-down link into `agent_operations`. */
  operationId?: string;
  outcome: TaskRecoveryOutcome;
}

/** Retry budget and spawn boundary for a Goal Graph Task. */
export class TaskRecoveryCoordinator {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  recover = async (params: {
    goal: GoalItem;
    spentCost?: number;
    task: TaskItem;
  }): Promise<TaskRecoveryResult> => {
    const { goal, task } = params;
    const attempts = task.totalTopics || 0;
    const attemptBudget = resolveTaskAttemptBudget(goal);
    if (attempts >= attemptBudget) return { outcome: 'exhausted-rounds' };

    if (typeof goal.maxTotalCost === 'number') {
      const spent =
        params.spentCost ??
        (await new AgentOperationModel(this.db, this.userId, this.workspaceId).sumCostByTask(
          task.id,
        ));
      if (spent >= goal.maxTotalCost) return { outcome: 'exhausted-cost' };
    }

    // Both recovery paths — a failed verification and an abandoned operation —
    // reach here from `tick`, and advances overlap: an event hook, a manual
    // nudge, the sweep. `runTask` decides whether a run is in flight by reading
    // the task's topics before creating one, so without this claim two
    // coordinators would each spawn a paid retry of the same Task.
    //
    // Both paths hand us a task row read before they paused it, so the claim
    // has to compare against what the row says now. A task already `running`
    // is one another advance has claimed — leave it to that one.
    const taskModel = new TaskModel(this.db, this.userId, this.workspaceId);
    const current = await taskModel.findById(task.id);
    if (!current || current.status === 'running') {
      log('task %s recovery was already claimed by another advance', task.identifier);
      return { outcome: 'already-running' };
    }
    const claimed = await taskModel.updateStatusIfCurrent(task.id, current.status, 'running', {
      error: null,
      startedAt: new Date(),
    });
    if (!claimed) {
      log('task %s recovery lost the claim race', task.identifier);
      return { outcome: 'already-running' };
    }

    try {
      const run = await new TaskRunnerService(this.db, this.userId, this.workspaceId).runTask({
        maxSteps: resolveTaskMaxSteps(goal),
        taskId: task.id,
        trigger: 'goal',
      });
      log('task %s → recovery attempt %d spawned', task.identifier, attempts + 1);
      return { operationId: run.operationId, outcome: 'started' };
    } catch (error) {
      log('task %s recovery spawn failed (non-fatal): %O', task.identifier, error);
      // We own the claim, so nothing else will put the task back.
      await taskModel
        .updateStatusIfCurrent(task.id, 'running', current.status, { error: current.error })
        .catch((releaseError) => {
          log('task %s failed to release the recovery claim: %O', task.identifier, releaseError);
        });
      return { outcome: 'spawn-failed' };
    }
  };
}
