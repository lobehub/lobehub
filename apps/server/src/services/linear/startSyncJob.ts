import type { LinearSyncJobErrorCode, LinearSyncJobMetadata } from '@lobechat/types';
import { AsyncTaskStatus, AsyncTaskType } from '@lobechat/types';
import { TRPCClientError } from '@trpc/client';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { LinearSyncJobModel, LinearSyncRuleModel } from '@/database/models/linear';
import type { LobeChatDatabase } from '@/database/type';
import { createAsyncCaller } from '@/server/routers/async';
import { after } from '@/server/utils/scheduleAfterResponse';

import { toLinearSyncJobView } from './syncJob';

/**
 * Hand-offs per job. Only a hand-off the async router turned away before
 * claiming the job (its internal token was rejected) is tried again, with a
 * freshly signed token.
 */
const MAX_DISPATCH_ATTEMPTS = 2;

/**
 * Record a Linear sync job and hand it to the async router, which runs it with
 * `LinearSyncJobService`. Kept apart from that service so the async router can
 * import it without importing itself back.
 */
export const startLinearSyncJob = async (
  db: LobeChatDatabase,
  userId: string,
  workspaceId: string | undefined,
  metadata: LinearSyncJobMetadata,
): Promise<string> => {
  const taskId = await recordJob(db, userId, workspaceId, metadata);
  await dispatchJob(db, userId, workspaceId, taskId);
  return taskId;
};

/**
 * Start a run of a saved rule, or return the one still going. The check and
 * the insert happen under a lock on the rule row, so two concurrent starts
 * (two tabs, two members) queue one run, not two.
 */
export const startLinearRuleSyncJob = async (
  db: LobeChatDatabase,
  userId: string,
  workspaceId: string | undefined,
  metadata: LinearSyncJobMetadata & { kind: 'rule'; ruleId: string },
): Promise<string> => {
  const scope = { userId, workspaceId: workspaceId ?? null };
  const { created, taskId } = await db.transaction(async (tx) => {
    if (!(await LinearSyncRuleModel.lockInScope(tx, metadata.ruleId, scope))) {
      throw new Error('Linear sync rule not found');
    }
    const running = await LinearSyncJobModel.findActiveForRule(
      tx,
      scope,
      metadata.projectId,
      metadata.ruleId,
    );
    if (running && toLinearSyncJobView(running).status !== 'error') {
      return { created: false, taskId: running.id };
    }
    return { created: true, taskId: await recordJob(tx, userId, workspaceId, metadata) };
  });
  if (created) await dispatchJob(db, userId, workspaceId, taskId);
  return taskId;
};

/**
 * Queue the next round of a rule run that stopped at its per-round cap. The
 * same job goes back to pending with the total so far, so it stays the one run
 * of its rule (a click on Sync joins it) and is handed off again like a new one.
 */
export const continueLinearRuleSyncJob = async (
  db: LobeChatDatabase,
  userId: string,
  workspaceId: string | undefined,
  taskId: string,
  metadata: LinearSyncJobMetadata,
): Promise<boolean> => {
  // A run the user stopped during this round is not queued again.
  const queued = await LinearSyncJobModel.transition(
    db,
    { userId, workspaceId: workspaceId ?? null },
    taskId,
    [AsyncTaskStatus.Processing],
    { metadata, status: AsyncTaskStatus.Pending },
  );
  if (queued) await dispatchJob(db, userId, workspaceId, taskId);
  return queued;
};

const recordJob = (
  db: LobeChatDatabase,
  userId: string,
  workspaceId: string | undefined,
  metadata: LinearSyncJobMetadata,
) =>
  new AsyncTaskModel(db, userId, workspaceId).create({
    metadata,
    status: AsyncTaskStatus.Pending,
    type: AsyncTaskType.LinearIssueSync,
  });

const dispatchJob = async (
  db: LobeChatDatabase,
  userId: string,
  workspaceId: string | undefined,
  taskId: string,
) => {
  // Only a job still waiting to be claimed; one the user stopped stays stopped.
  const fail = () =>
    LinearSyncJobModel.transition(
      db,
      { userId, workspaceId: workspaceId ?? null },
      taskId,
      [AsyncTaskStatus.Pending],
      { error: { code: 'failed' satisfies LinearSyncJobErrorCode }, status: AsyncTaskStatus.Error },
    );

  // Kept alive past the response, so a rejected hand-off can still be retried
  // or reported; otherwise the job sits queued until the client gives up on it.
  after(async () => {
    for (let attempt = 1; ; attempt++) {
      let asyncCaller: Awaited<ReturnType<typeof createAsyncCaller>>;
      try {
        // Signs a new internal token, so a retry never resends a rejected one.
        asyncCaller = await createAsyncCaller({ userId });
      } catch (error) {
        // Logged in production too: a lost hand-off otherwise leaves no trace.
        console.error('[linear-sync] trigger sync %s failed: %O', taskId, error);
        await fail();
        return;
      }
      try {
        await asyncCaller.linear.runSync({ taskId, workspaceId });
        return;
      } catch (error) {
        // A dropped response (a proxy timing out a long run) is not a failed
        // sync: the async router claimed the job and owns it from there. A
        // request the host answered without running it (e.g. Vercel's 508 on
        // a deep chain of requests) left the job unclaimed for good, so it is
        // shown as failed now instead of sitting queued until it times out.
        // An error without an answer (a dropped connection) may still be on
        // its way to the router, which must be able to claim it; that job
        // times out as unclaimed if it never arrives.
        if (!isRejectedHandOff(error)) {
          console.error('[linear-sync] hand-off of sync %s failed: %O', taskId, error);
          if (isAnsweredHandOff(error)) await fail();
          return;
        }
        console.warn(
          '[linear-sync] hand-off of sync %s rejected (attempt %d): %O',
          taskId,
          attempt,
          error,
        );
        if (attempt >= MAX_DISPATCH_ATTEMPTS) {
          await fail();
          return;
        }
      }
    }
  });
};

/**
 * The host sent an answer, so the request is over: had the router run it, it
 * would have claimed the job first, and `fail` only touches an unclaimed one.
 * A tRPC answer carries its response; a host page that is not tRPC JSON (such
 * as Vercel's 508) fails to parse, which a dropped connection never does.
 */
const isAnsweredHandOff = (error: unknown) =>
  error instanceof TRPCClientError &&
  (error.meta?.response !== undefined || error.cause instanceof SyntaxError);

/** The async router refused the call before running it, so the job is still unclaimed. */
const isRejectedHandOff = (error: unknown) =>
  error instanceof TRPCClientError && error.data?.code === 'UNAUTHORIZED';
