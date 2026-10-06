import { ABANDONED_OPERATION_ERROR_PREFIX, LEASE_EXPIRED_ERROR } from '@lobechat/const/goal';
import { extractErrorMessage } from '@lobechat/model-runtime/errors';
import debug from 'debug';

import type { OrphanedRunningTopic } from '@/database/models/task';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { TaskRunClaimRepo } from '@/database/repositories/taskRunClaim';
import type { LobeChatDatabase } from '@/database/type';
import { resolveFailedRunStatus } from '@/server/services/goal/recoveryPolicy';

import { TaskLifecycleService } from './index';

const log = debug('task-lifecycle:reconcile');

/**
 * How long a run may hold a `running` row after its operation already ended
 * before the sweep calls it orphaned.
 *
 * The operation is settled *before* its `onComplete` hook is dispatched, so this
 * window is what keeps the sweep from racing the normal path — including a hook
 * whose first delivery fails and is retried. It is deliberately the same order
 * of magnitude as the goal sweep's own stale window: both are looking for the
 * same class of lost delivery, just from opposite ends of the graph.
 */
export const ORPHANED_RUN_GRACE_MS = 15 * 60 * 1000;

export interface ReconcileOrphanedRunsOptions {
  /**
   * Cap on the rows settled in one pass. A backlog of historical zombies drains
   * over successive ticks instead of settling hundreds of Tasks — and emitting
   * a failure card for each — in a single burst.
   */
  limit?: number;
  /** Override the grace window. Tests use it to age a fixture. */
  staleBefore?: Date;
}

export interface ReconcileOrphanedRunsResult {
  /** Rows the finder returned. */
  checked: number;
  /** Topic ids this pass actually settled. */
  converged: string[];
  /** Rows whose settle failed; they stay `running` for the next pass to retry. */
  failed: string[];
  /** Rows another writer claimed first, or whose run moved on under us. */
  skipped: string[];
}

/**
 * Settle Task runs whose operation ended without reaching the Task.
 *
 * The run's terminal state normally reaches `task_topics` / `tasks` through its
 * `onComplete` webhook. That delivery is fire-and-forget, so when it is lost —
 * the watchdog abandoning a run is the common case — nothing settles the rows
 * and the Task keeps a `running` run forever (LOBE-12391). Downstream, that
 * stale row reads as a live run: the Goal view shows the dead attempt's frozen
 * heartbeat, and the coordinator parks on it instead of recovering.
 *
 * This is the second entry point into the same `TaskLifecycleService`, not a
 * parallel implementation of it: the converge drives `onTopicComplete` with the
 * outcome the run actually had, so every Task kind keeps the behaviour it would
 * have got from the hook — automation fuse arithmetic, the goal retry for a lost
 * run, the error brief, the verify boundary.
 */
export const reconcileOrphanedTaskRuns = async (
  db: LobeChatDatabase,
  options: ReconcileOrphanedRunsOptions = {},
): Promise<ReconcileOrphanedRunsResult> => {
  const staleBefore = options.staleBefore ?? new Date(Date.now() - ORPHANED_RUN_GRACE_MS);
  const rows = await TaskModel.findOrphanedRunningTopics(db, {
    limit: options.limit,
    staleBefore,
  });

  const converged: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];

  for (const row of rows) {
    try {
      const settled = await settleOrphanedRun(db, row);
      if (settled) converged.push(row.topicId);
      else skipped.push(row.topicId);
    } catch (error) {
      // One row must not take the sweep down with it; the rest are independent.
      failed.push(row.topicId);
      console.error('[task-reconcile] orphaned run settle failed: %O', { error, row });
    }
  }

  log(
    'orphaned runs: checked=%d converged=%d skipped=%d failed=%d',
    rows.length,
    converged.length,
    skipped.length,
    failed.length,
  );

  return { checked: rows.length, converged, failed, skipped };
};

/**
 * Settle one orphaned run, or report that somebody else got there first.
 *
 * The claim comes first: a `task_topics` row only moves out of `running` while
 * it still names *this* operation, so two overlapping sweeps — or a hook that
 * finally lands late — can never report the same dead run twice. It is handed
 * back if the settle then fails, because a row left terminal with its Task still
 * `running` is precisely the shape this reconciliation exists to remove.
 */
const settleOrphanedRun = async (
  db: LobeChatDatabase,
  row: OrphanedRunningTopic,
): Promise<boolean> => {
  const errorMessage = resolveOrphanedRunError(row);
  const runStatus = resolveFailedRunStatus(errorMessage);
  const claimRepo = new TaskRunClaimRepo(db, row.userId, row.workspaceId ?? undefined);

  if (!(await claimRepo.claim(row.topicId, row.operationId, runStatus))) {
    return false;
  }

  try {
    await new TaskLifecycleService(db, row.userId, row.workspaceId ?? undefined).onTopicComplete({
      // The structured type picks the error brief's remedy (a budget failure
      // leads with "Upgrade plan"), exactly as the lost hook would have.
      errorCode: resolveOrphanedRunErrorType(row),
      errorMessage,
      operationId: row.operationId,
      reason: 'error',
      // The trigger decides whether a failure touches an automation task's
      // schedule state, so it must be the one the run actually started with.
      runTrigger: row.trigger ?? undefined,
      taskId: row.taskId,
      taskIdentifier: row.taskIdentifier,
      topicId: row.topicId,
    });
  } catch (error) {
    await handBackClaimedRun(db, row, runStatus, claimRepo).catch((rollbackError) =>
      console.error('[task-reconcile] failed to re-open a claimed run: %O', {
        error: rollbackError,
        operationId: row.operationId,
      }),
    );
    throw error;
  }

  return true;
};

/**
 * Undo the claim of a run whose settle failed — but only while that can still
 * be retried.
 *
 * The finder only picks runs whose Task is still `running`. When the lifecycle
 * threw *after* moving the Task on (to `paused` / `scheduled`, say), re-opening
 * the run would strand it: a `running` run under a Task the sweep never looks at
 * again. The Task transition is the settle's decisive write, so a run that got
 * that far stays settled; only a Task still `running` gets its run handed back.
 */
const handBackClaimedRun = async (
  db: LobeChatDatabase,
  row: OrphanedRunningTopic,
  runStatus: string,
  claimRepo: TaskRunClaimRepo,
): Promise<void> => {
  const task = await new TaskModel(db, row.userId, row.workspaceId ?? undefined).findById(
    row.taskId,
  );
  if (task && task.status !== 'running') {
    log(
      'settle of %s failed after its Task moved to %s; keeping the run settled',
      row.topicId,
      task.status,
    );
    return;
  }

  await claimRepo.release(row.topicId, row.operationId, runStatus);
};

/**
 * The failure text an orphaned run is settled with.
 *
 * The operation's own recorded failure is preferred, so a device-offline run or
 * a watchdog abandonment keeps its specific classification — `resolveFailedRunStatus`
 * reads this text for the run row, and the Goal coordinator's `isLostRunError`
 * decides retry-versus-human-gate from it.
 *
 * With nothing recorded, the run is settled as a lost run rather than as a
 * judged failure: no delivery ever happened, nobody judged the work, and
 * `LEASE_EXPIRED_ERROR` is the existing vocabulary for exactly that. Settling it
 * as an unrecoverable failure instead would open a decision gate for work that
 * only needs another attempt.
 */
const resolveOrphanedRunError = (row: OrphanedRunningTopic): string => {
  // `agent_operations.error` holds the raw `state.error`, so the message can sit
  // nested — a provider failure is `{ errorType, error: { message } }`. Read it
  // the way the completion hook does, or a real quota / provider failure would
  // fall through to the lost-run text and be retried as if nothing judged it.
  const recorded = extractErrorMessage(row.operationError);
  if (recorded?.trim()) return recorded.trim();

  if (row.operationStatus === 'abandoned') {
    return `${ABANDONED_OPERATION_ERROR_PREFIX} ${row.completionReason ?? 'lease_expired'}`;
  }

  return LEASE_EXPIRED_ERROR;
};

/**
 * The structured error type the operation recorded, if any — the raw payload
 * carries it as `errorType`, a normalized one as `type`.
 */
const resolveOrphanedRunErrorType = (row: OrphanedRunningTopic): string | undefined => {
  const error = row.operationError;
  if (!error) return undefined;
  const type = error.errorType ?? error.type;
  return typeof type === 'string' && type ? type : undefined;
};

export interface SettledRunQuery {
  operationId: string;
  reason: string;
  taskId: string;
  topicId?: string;
}

/**
 * Whether a failed run's `onComplete` delivery arrives for a run that was
 * already settled — by this reconciliation, most often, when the hook was
 * delayed past the grace window rather than lost.
 *
 * The lifecycle is not idempotent: driving it twice emits a second urgent error
 * brief, counts the failure into an automation's fuse twice, and re-parks a Task
 * that may have moved on. The sweep's claim fences competing sweeps; this is the
 * same fence read from the callback side. A run is settled once its own row has
 * left `running` *and* its Task has moved on: the sweep makes both writes, as
 * does a callback that already ran to completion. A row that is terminal under a
 * Task still `running` is a settle that broke midway, and is let through so the
 * retry can finish it.
 *
 * Only failures are fenced — the sweep never settles a successful or interrupted
 * run, so those deliveries keep their existing behaviour.
 */
export const isRunAlreadySettled = async (
  db: LobeChatDatabase,
  userId: string,
  workspaceId: string | undefined,
  { operationId, reason, taskId, topicId }: SettledRunQuery,
): Promise<boolean> => {
  if (reason !== 'error' || !topicId) return false;

  const run = await new TaskTopicModel(db, userId, workspaceId).findByTopicId(topicId);
  if (!run || run.taskId !== taskId || run.operationId !== operationId) return false;
  if (run.status === 'running') return false;

  const task = await new TaskModel(db, userId, workspaceId).findById(taskId);
  return !!task && task.status !== 'running';
};
