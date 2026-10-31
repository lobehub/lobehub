import type { LinearSyncJobErrorCode, LinearSyncJobMetadata } from '@lobechat/types';
import { AsyncTaskStatus, AsyncTaskType } from '@lobechat/types';
import { TRPCClientError } from '@trpc/client';
import debug from 'debug';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { LinearSyncJobModel, LinearSyncRuleModel } from '@/database/models/linear';
import type { LobeChatDatabase } from '@/database/type';
import { createAsyncCaller } from '@/server/routers/async';
import { after } from '@/server/utils/scheduleAfterResponse';

import { toLinearSyncJobView } from './syncJob';

const log = debug('lobe-server:linear:sync-job');

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
  const fail = () =>
    new AsyncTaskModel(db, userId, workspaceId).update(taskId, {
      error: { code: 'failed' satisfies LinearSyncJobErrorCode },
      status: AsyncTaskStatus.Error,
    });

  // Kept alive past the response, so a rejected hand-off can still be retried
  // or reported; otherwise the job sits queued until the client gives up on it.
  after(async () => {
    for (let attempt = 1; ; attempt++) {
      let asyncCaller: Awaited<ReturnType<typeof createAsyncCaller>>;
      try {
        // Signs a new internal token, so a retry never resends a rejected one.
        asyncCaller = await createAsyncCaller({ userId });
      } catch (error) {
        log('trigger sync %s failed: %O', taskId, error);
        await fail();
        return;
      }
      try {
        await asyncCaller.linear.runSync({ taskId, workspaceId });
        return;
      } catch (error) {
        // Any other failure reached the async router, which owns the job from
        // there; a dropped response (a proxy timing out a long run) is not a
        // failed sync, so only log it.
        if (!isRejectedHandOff(error)) {
          log('async sync %s request failed: %O', taskId, error);
          return;
        }
        log('async sync %s hand-off rejected (attempt %d): %O', taskId, attempt, error);
        if (attempt >= MAX_DISPATCH_ATTEMPTS) {
          await fail();
          return;
        }
      }
    }
  });
};

/** The async router refused the call before running it, so the job is still unclaimed. */
const isRejectedHandOff = (error: unknown) =>
  error instanceof TRPCClientError && error.data?.code === 'UNAUTHORIZED';
