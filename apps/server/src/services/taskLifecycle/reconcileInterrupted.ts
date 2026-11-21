import debug from 'debug';

import type { InterruptedRunningTopic } from '@/database/models/task';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import type { LobeChatDatabase } from '@/database/type';

import { ORPHANED_RUN_GRACE_MS } from './reconcile';

const log = debug('task-lifecycle:reconcile-interrupted');

/**
 * The run status an interrupted run is settled with — the same one a user's
 * Stop (`TaskService.cancelTopic`) writes.
 */
const INTERRUPTED_RUN_STATUS = 'canceled';

export interface ReconcileInterruptedRunsOptions {
  /** Cap on the rows settled in one pass, so a backlog drains over ticks. */
  limit?: number;
  /** Override the grace window. Tests use it to age a fixture. */
  staleBefore?: Date;
}

export interface ReconcileInterruptedRunsResult {
  checked: number;
  /** Rows whose settle failed; they stay `running` for the next pass. */
  failed: string[];
  /** Topic ids whose Task this pass moved to `paused`. */
  paused: string[];
  /** Rows another writer settled or took over first. */
  skipped: string[];
}

/**
 * Park Tasks whose run was interrupted and that nothing took over.
 *
 * An interrupt never settles a run: when a user follows up in the run's
 * conversation, the follow-up takes the run row over and settles it when it
 * ends. If no follow-up took it over, the row stays `running` under an
 * operation that will never report again, and so does the Task.
 *
 * The Task is moved to `paused` — the state a user's own Stop leaves it in —
 * not `failed` or `completed`: an interrupt is not a verdict on the work, so it
 * goes back to a person. A topic with any operation still in flight is left
 * alone (see `TaskModel.findInterruptedRunningTopics`), so a Task that is still
 * continuing is never parked under it.
 */
export const reconcileInterruptedTaskRuns = async (
  db: LobeChatDatabase,
  options: ReconcileInterruptedRunsOptions = {},
): Promise<ReconcileInterruptedRunsResult> => {
  const staleBefore = options.staleBefore ?? new Date(Date.now() - ORPHANED_RUN_GRACE_MS);
  const rows = await TaskModel.findInterruptedRunningTopics(db, {
    limit: options.limit,
    staleBefore,
  });

  const paused: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];

  for (const row of rows) {
    try {
      if (await parkInterruptedRun(db, row)) {
        paused.push(row.topicId);
        // The Task is parked without a brief, so leave the trail here.
        console.info('[task-reconcile] paused task after an interrupted run nothing took over', {
          operationId: row.operationId,
          taskId: row.taskId,
          topicId: row.topicId,
        });
      } else skipped.push(row.topicId);
    } catch (error) {
      failed.push(row.topicId);
      console.error('[task-reconcile] interrupted run settle failed: %O', { error, row });
    }
  }

  log(
    'interrupted runs: checked=%d paused=%d skipped=%d failed=%d',
    rows.length,
    paused.length,
    skipped.length,
    failed.length,
  );

  return { checked: rows.length, failed, paused, skipped };
};

/**
 * Settle one interrupted run and park its Task, as one unit.
 *
 * The row moves only while it is still `running` under the interrupted
 * operation, so a follow-up that took it over in the meantime — or a user's
 * Stop that settled it — wins, and the sweep reports a skip.
 */
const parkInterruptedRun = async (
  db: LobeChatDatabase,
  row: InterruptedRunningTopic,
): Promise<boolean> =>
  db.transaction(async (tx) => {
    const workspaceId = row.workspaceId ?? undefined;
    const taskTopicModel = new TaskTopicModel(tx, row.userId, workspaceId);

    if (
      !(await taskTopicModel.claimRunIfRunning(
        row.topicId,
        row.operationId,
        INTERRUPTED_RUN_STATUS,
      ))
    )
      return false;
    await taskTopicModel.markTopicEnded(row.topicId, INTERRUPTED_RUN_STATUS);

    // Only from `running`: a Task the user already moved on keeps its state.
    await new TaskModel(tx, row.userId, workspaceId).updateStatusIfCurrent(
      row.taskId,
      'running',
      'paused',
    );
    return true;
  });
