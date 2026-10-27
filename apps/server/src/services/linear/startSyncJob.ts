import type { LinearSyncJobErrorCode, LinearSyncJobMetadata } from '@lobechat/types';
import { AsyncTaskStatus, AsyncTaskType } from '@lobechat/types';
import debug from 'debug';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import type { LobeChatDatabase } from '@/database/type';
import { createAsyncCaller } from '@/server/routers/async';

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
  const asyncTaskModel = new AsyncTaskModel(db, userId, workspaceId);
  const taskId = await asyncTaskModel.create({
    metadata,
    status: AsyncTaskStatus.Pending,
    type: AsyncTaskType.LinearIssueSync,
  });

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
    await asyncTaskModel.update(taskId, {
      error: { code: 'failed' satisfies LinearSyncJobErrorCode },
      status: AsyncTaskStatus.Error,
    });
  }
  return taskId;
};
