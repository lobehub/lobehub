import type { LinearSyncJobErrorCode, LinearSyncJobMetadata } from '@lobechat/types';
import { AsyncTaskStatus, AsyncTaskType } from '@lobechat/types';
import debug from 'debug';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { LinearSyncJobModel, LinearSyncRuleModel } from '@/database/models/linear';
import type { LobeChatDatabase } from '@/database/type';
import { createAsyncCaller } from '@/server/routers/async';

import { toLinearSyncJobView } from './syncJob';

const log = debug('lobe-server:linear:sync-job');

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
  try {
    const asyncCaller = await createAsyncCaller({ userId });
    // Fire and forget: the async router owns the job once the request reaches
    // it, so a dropped response here (a proxy timing out a long run) is not a
    // failed sync; only log it.
    asyncCaller.linear
      .runSync({ taskId, workspaceId })
      .catch((error: unknown) => log('async sync %s request failed: %O', taskId, error));
  } catch (error) {
    log('trigger sync %s failed: %O', taskId, error);
    await new AsyncTaskModel(db, userId, workspaceId).update(taskId, {
      error: { code: 'failed' satisfies LinearSyncJobErrorCode },
      status: AsyncTaskStatus.Error,
    });
  }
};
