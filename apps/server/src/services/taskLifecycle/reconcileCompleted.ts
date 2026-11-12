import { TaskModel } from '@/database/models/task';
import { TaskRunClaimRepo } from '@/database/repositories/taskRunClaim';
import type { LobeChatDatabase } from '@/database/type';

import { ORPHANED_RUN_GRACE_MS } from './constants';

/**
 * Stop successful operations from leaving their run cards live forever.
 *
 * This deliberately does not replay onTopicComplete: a Task may already have
 * failed or paused, and repeating success delivery could emit duplicate creator
 * callbacks or schedule another heartbeat. Only the run and its topic end stamp
 * converge, atomically and only while this operation still owns the run row.
 */
export const reconcileCompletedTaskRuns = async (
  db: LobeChatDatabase,
  options: { limit?: number; staleBefore?: Date } = {},
): Promise<{ checked: number; converged: string[]; failed: string[]; skipped: string[] }> => {
  const rows = await TaskModel.findCompletedRunningTopics(db, {
    limit: options.limit,
    staleBefore: options.staleBefore ?? new Date(Date.now() - ORPHANED_RUN_GRACE_MS),
  });
  const converged: string[] = [];
  const failed: string[] = [];
  const skipped: string[] = [];

  for (const row of rows) {
    try {
      const claimed = await new TaskRunClaimRepo(
        db,
        row.userId,
        row.workspaceId ?? undefined,
      ).claim(row.topicId, row.operationId, 'completed');
      if (claimed) converged.push(row.topicId);
      else skipped.push(row.topicId);
    } catch (error) {
      failed.push(row.topicId);
      console.error('[task-reconcile] completed run settle failed: %O', { error, row });
    }
  }

  return { checked: rows.length, converged, failed, skipped };
};
