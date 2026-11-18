import type { AgentOperationStatus } from '@lobechat/types';
import { isAgentOperationInFlight, isAgentOperationSettled } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { TaskRunClaimRepo } from '@/database/repositories/taskRunClaim';
import type { LobeChatDatabase } from '@/database/type';
import { resolveFailedRunStatus } from '@/server/services/goal/recoveryPolicy';
import {
  ORPHANED_RUN_GRACE_MS,
  resolveOrphanedRunError,
} from '@/server/services/taskLifecycle/reconcile';

const log = debug('task-runner:run-conflict');

/** The run-row fields this check reads. */
interface BlockingRunRow {
  operationId: string | null;
  topicId: string | null;
}

type OperationRecord = NonNullable<Awaited<ReturnType<AgentOperationModel['findById']>>>;

/**
 * What a `running` run row that stands in the way of a new run really is.
 *
 * The row's status is only what the Task side last wrote. Its operation's
 * terminal state reaches the row through a fire-and-forget completion hook, and
 * the reconciliation sweeps only repair rows under a Task that is still
 * `running`, and only for some operation outcomes. A scheduled Task that went
 * back to `scheduled` keeps a dead row forever: every tick skips it as
 * in-flight and every manual run is refused.
 */
type BlockingRun =
  /** An operation on the topic has not settled: a real concurrent run. */
  | { kind: 'live'; operationId: string; since: Date; status: AgentOperationStatus }
  /** The run ended a moment ago and its completion hook may still land. */
  | { kind: 'settling'; endedAt: Date; operationId: string; status: AgentOperationStatus }
  /** The run ended long ago and nothing on the topic is in flight. */
  | { kind: 'stale'; operation: OperationRecord }
  /** No operation to judge the row against; leave the call to a person. */
  | { kind: 'unknown' };

interface RunConflictContext {
  db: LobeChatDatabase;
  userId: string;
  workspaceId?: string;
}

const endedAt = (operation: OperationRecord): Date =>
  new Date(operation.completedAt ?? operation.updatedAt);

const inspectBlockingRun = async (
  ctx: RunConflictContext,
  row: BlockingRunRow,
  now: number,
): Promise<BlockingRun> => {
  if (!row.operationId || !row.topicId) return { kind: 'unknown' };

  const operationModel = new AgentOperationModel(ctx.db, ctx.userId, ctx.workspaceId);
  const operation = await operationModel.findById(row.operationId);
  if (!operation) return { kind: 'unknown' };

  if (isAgentOperationInFlight(operation.status)) {
    return {
      kind: 'live',
      operationId: operation.id,
      since: new Date(operation.updatedAt),
      status: operation.status,
    };
  }

  // A follow-up started in the run's conversation may not own the row yet; a
  // topic with anything still in flight is a run that is still going.
  const [liveOnTopic] = await operationModel.findLiveByTopic(row.topicId);
  if (liveOnTopic) {
    return {
      kind: 'live',
      operationId: liveOnTopic.id,
      since: new Date(liveOnTopic.updatedAt),
      status: liveOnTopic.status,
    };
  }

  if (!isAgentOperationSettled(operation.status)) return { kind: 'unknown' };

  // Same grace window as the reconciliation sweep: the operation is settled
  // before its hook is dispatched, so a recent end may still be reported.
  if (now - endedAt(operation).getTime() < ORPHANED_RUN_GRACE_MS) {
    return {
      endedAt: endedAt(operation),
      kind: 'settling',
      operationId: operation.id,
      status: operation.status,
    };
  }

  return { kind: 'stale', operation };
};

/** The run status the lost completion hook would have written. */
const settledRunStatus = (operation: OperationRecord): string => {
  if (operation.status === 'done') return 'completed';
  // Same status a user's Stop and the interrupted-run sweep write.
  if (operation.status === 'interrupted') return 'canceled';
  return resolveFailedRunStatus(
    resolveOrphanedRunError({
      completionReason: operation.completionReason,
      operationError: operation.error ?? null,
      operationStatus: operation.status,
    }),
  );
};

const STOP_HINT = (topicId: string) =>
  `stop it first with \`lh task topic cancel ${topicId}\` (this pauses the task; resume it afterwards)`;

const conflictMessage = (topicId: string, continuing: boolean, run: BlockingRun): string => {
  const head = continuing
    ? `Topic ${topicId} is already running`
    : `Task already has a running topic (${topicId})`;

  switch (run.kind) {
    case 'live': {
      return `${head}: operation ${run.operationId} is ${run.status} (last update ${run.since.toISOString()}). Wait for it to finish, or ${STOP_HINT(topicId)}.`;
    }
    case 'settling': {
      const retryAt = new Date(run.endedAt.getTime() + ORPHANED_RUN_GRACE_MS);
      return `${head}: operation ${run.operationId} ended (${run.status}) at ${run.endedAt.toISOString()} and its result is still being recorded. Retry after ${retryAt.toISOString()}.`;
    }
    default: {
      return `${head}, but no operation can be found for it. If nothing is running there, ${STOP_HINT(topicId)}.`;
    }
  }
};

/**
 * Clear a `running` run row that blocks a new run, or refuse the run with what
 * is actually going on.
 *
 * A row whose operation ended past the grace window, with nothing else in
 * flight on its topic, is a leftover: it is settled with the status its lost
 * hook would have written and the new run goes ahead. Anything else is a real
 * conflict, and the error names the operation, its status and what to do next.
 *
 * Only the run row and the topic's end stamp are written, not the Task
 * lifecycle: the caller is starting the next run of this Task right now, so a
 * failure brief or a Task transition for the dead one would only be noise.
 */
export const clearBlockingRun = async (
  ctx: RunConflictContext,
  row: BlockingRunRow,
  options: { continuing: boolean; now?: number },
): Promise<void> => {
  const topicId = row.topicId ?? 'unknown';
  const now = options.now ?? Date.now();
  const run = await inspectBlockingRun(ctx, row, now);

  if (run.kind === 'stale') {
    const status = settledRunStatus(run.operation);
    const claimed = await new TaskRunClaimRepo(ctx.db, ctx.userId, ctx.workspaceId).claim(
      topicId,
      run.operation.id,
      status,
    );
    if (claimed) {
      log(
        'settled stale run %s (operation %s ended %s) as %s',
        topicId,
        run.operation.id,
        run.operation.status,
        status,
      );
      return;
    }

    // Someone else settled it (fine) or a newer run took the row over (not).
    const current = await new TaskTopicModel(ctx.db, ctx.userId, ctx.workspaceId).findByTopicId(
      topicId,
    );
    if (current?.status !== 'running') return;

    const latest = await inspectBlockingRun(ctx, current, now);
    throw new TRPCError({
      code: 'CONFLICT',
      message: conflictMessage(
        topicId,
        options.continuing,
        latest.kind === 'stale' ? { kind: 'unknown' } : latest,
      ),
    });
  }

  throw new TRPCError({
    code: 'CONFLICT',
    message: conflictMessage(topicId, options.continuing, run),
  });
};
