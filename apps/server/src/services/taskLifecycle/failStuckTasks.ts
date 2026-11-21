import debug from 'debug';

import { notifyTaskRunFailed } from '@/business/server/task/notifyTaskRunFailed';
import { TaskModel } from '@/database/models/task';
import type { LobeChatDatabase } from '@/database/type';

const log = debug('lobe-server:task:fail-stuck-tasks');

/**
 * Heartbeat net of the task watchdog: marks every Task silent past its
 * `heartbeatTimeout` as `failed` and tells its owner.
 *
 * Use when:
 * - A watchdog sweep (cron workflow or the manual tRPC trigger) runs
 *
 * Returns:
 * - How many Tasks were checked and the identifiers that were failed
 */
export const failStuckTasks = async (
  db: LobeChatDatabase,
): Promise<{
  checked: number;
  failed: string[];
  failedTasks: { id: string; identifier: string }[];
}> => {
  const stuckTasks = await TaskModel.findStuckTasks(db);
  const failed: string[] = [];
  const failedTasks: { id: string; identifier: string }[] = [];

  for (const task of stuckTasks) {
    const workspaceId = task.workspaceId ?? undefined;
    await new TaskModel(db, task.createdByUserId, workspaceId).updateStatus(task.id, 'failed', {
      completedAt: new Date(),
      error: 'Heartbeat timeout',
    });

    // A timeout is a failure, not a decision: tell the owner through the
    // notification center instead of a "Needs you" error brief. Fire-and-forget
    // through the `@/business` slot so a notification failure never stops the sweep.
    void notifyTaskRunFailed({
      agentId: task.assigneeAgentId || undefined,
      reason: 'heartbeat_timeout',
      taskId: task.id,
      taskIdentifier: task.identifier,
      taskName: task.name ?? undefined,
      userId: task.createdByUserId,
      workspaceId,
    }).catch((error) =>
      log('failure notification failed for task=%s (non-fatal): %O', task.identifier, error),
    );

    failed.push(task.identifier);
    failedTasks.push({ id: task.id, identifier: task.identifier });
  }

  return { checked: stuckTasks.length, failed, failedTasks };
};
