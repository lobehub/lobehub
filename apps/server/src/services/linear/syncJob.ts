import type {
  LinearSyncJobErrorCode,
  LinearSyncJobMetadata,
  LinearSyncJobView,
  LinearSyncResult,
} from '@lobechat/types';
import { AsyncTaskStatus } from '@lobechat/types';
import debug from 'debug';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import type { LinearSyncJobRow } from '@/database/models/linear';
import { LinearSyncJobModel, LinearSyncRuleModel } from '@/database/models/linear';
import { ProjectModel } from '@/database/models/project';
import type { LobeChatDatabase } from '@/database/type';

import { LinearApiError } from './client';
import { LinearIssueSyncService } from './issueSync';
import { getLinearAccessToken, LinearReconnectRequiredError } from './token';

const log = debug('lobe-server:linear:sync-job');

/**
 * A run that has not moved for this long was cut off (a deploy, a crashed
 * function); it is shown as failed so the user can start it again.
 */
export const LINEAR_SYNC_STALE_MS = 15 * 60 * 1000;
/** How often a running sync records that it is still alive; well inside the stale window. */
export const LINEAR_SYNC_HEARTBEAT_MS = 60 * 1000;
/**
 * A job the async router never picked up (the hand-off failed, or its token
 * expired on the way) is given up on much sooner than a running one.
 */
export const LINEAR_SYNC_UNCLAIMED_MS = 2 * 60 * 1000;

export const toLinearSyncJobView = (
  row: LinearSyncJobRow,
  now: number = Date.now(),
): LinearSyncJobView => {
  const metadata = row.metadata;
  const idle = now - row.updatedAt.getTime();
  const stale =
    (row.status === AsyncTaskStatus.Pending && idle > LINEAR_SYNC_UNCLAIMED_MS) ||
    (row.status === AsyncTaskStatus.Processing && idle > LINEAR_SYNC_STALE_MS);
  const error = (row.error as { code?: LinearSyncJobErrorCode } | null)?.code ?? null;
  return {
    createdAt: row.createdAt,
    error: stale ? 'timeout' : row.status === AsyncTaskStatus.Error ? (error ?? 'failed') : null,
    id: row.id,
    issueCount: metadata.issueIds?.length,
    kind: metadata.kind,
    projectId: metadata.projectId,
    result: metadata.result ?? null,
    ruleId: metadata.ruleId ?? null,
    status: stale ? 'error' : ((row.status ?? 'pending') as LinearSyncJobView['status']),
    updatedAt: row.updatedAt,
  };
};

class LinearSyncJobError extends Error {
  constructor(readonly code: LinearSyncJobErrorCode) {
    super(code);
  }
}

/**
 * Runs a Linear → task sync in the background. The lambda request records
 * the job and hands it to the async router (`linear.runSync`, see
 * `startLinearSyncJob`), which runs it here and owns its status; the client
 * polls the job instead of holding a request open, and may leave while it
 * runs. Linear is only read.
 */
export class LinearSyncJobService {
  private readonly asyncTaskModel: AsyncTaskModel;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {
    this.asyncTaskModel = new AsyncTaskModel(db, userId, workspaceId);
  }

  /** Run a recorded job to completion (async router side). */
  async run(taskId: string): Promise<void> {
    const task = await LinearSyncJobModel.claim(this.db, this.scope, taskId);
    if (!task) return;

    const metadata = task.metadata;
    const startedAt = Date.now();
    // A long sync keeps its lease, so it is not shown as cut off and the same
    // rule cannot be started again while it still writes tasks.
    const heartbeat = setInterval(() => {
      LinearSyncJobModel.touch(this.db, this.scope, taskId).catch((error: unknown) =>
        log('heartbeat %s failed: %O', taskId, error),
      );
    }, LINEAR_SYNC_HEARTBEAT_MS);
    try {
      const result = await this.execute(metadata);
      await this.asyncTaskModel.update(taskId, {
        duration: Date.now() - startedAt,
        metadata: { ...metadata, result },
        status: AsyncTaskStatus.Success,
      });
    } catch (error) {
      const code = toErrorCode(error);
      log('sync %s failed (%s): %O', taskId, code, error);
      await this.asyncTaskModel.update(taskId, {
        duration: Date.now() - startedAt,
        error: { code },
        status: AsyncTaskStatus.Error,
      });
    } finally {
      clearInterval(heartbeat);
    }
  }

  private get scope() {
    return { userId: this.userId, workspaceId: this.workspaceId ?? null };
  }

  private async execute(metadata: LinearSyncJobMetadata): Promise<LinearSyncResult> {
    const scope = this.scope;
    // The project may have been deleted or hidden since the job was queued.
    const project = await new ProjectModel(this.db, this.userId, this.workspaceId).findById(
      metadata.projectId,
    );
    if (!project) throw new LinearSyncJobError('unavailable');

    const sync = new LinearIssueSyncService(this.db, this.userId, this.workspaceId);
    const options = { targetProjectId: metadata.projectId };

    if (metadata.kind === 'issues') {
      const token = await getLinearAccessToken(this.db, metadata.connectionId);
      return sync.importIssues(token, metadata.issueIds ?? [], options);
    }

    const rule = metadata.ruleId
      ? await LinearSyncRuleModel.findInScope(this.db, metadata.ruleId, scope)
      : null;
    if (!rule || rule.projectId !== metadata.projectId) throw new LinearSyncJobError('unavailable');
    const token = await getLinearAccessToken(this.db, rule.connectionId);
    const result = await sync.syncByFilter(
      token,
      { linearProjectId: rule.linearProjectId, stateTypes: rule.stateTypes, teamId: rule.teamId },
      options,
    );
    await LinearSyncRuleModel.recordRun(this.db, rule.id, scope, result);
    return result;
  }
}

const toErrorCode = (error: unknown): LinearSyncJobErrorCode => {
  if (error instanceof LinearSyncJobError) return error.code;
  if (
    error instanceof LinearReconnectRequiredError ||
    (error instanceof LinearApiError && error.status === 401)
  ) {
    return 'reconnect';
  }
  return 'failed';
};
