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
/**
 * Rounds one rule run takes before it stops and asks to be run again. Each
 * round creates at most `MAX_TASKS_CREATED_PER_SYNC` tasks, so this bounds a
 * run at about 5,000 new tasks.
 */
export const LINEAR_SYNC_MAX_ROUNDS = 50;

/**
 * The outcome of a run that took several rounds. Each round re-reads the
 * issues before it, so counts of what a round only looked at (unchanged, kept
 * edits, skipped) come from the latest round, which saw the most; what a round
 * wrote happens once and adds up.
 */
export const mergeLinearSyncResults = (
  previous: LinearSyncResult | undefined,
  latest: LinearSyncResult,
): LinearSyncResult =>
  previous
    ? {
        ...latest,
        closed: previous.closed + latest.closed,
        created: previous.created + latest.created,
        updated: previous.updated + latest.updated,
      }
    : latest;

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

/**
 * Queues the next round of a rule run. Supplied by the async router, which
 * owns hand-offs; without it a run stops after one round and asks to be run
 * again.
 */
export type ContinueLinearSyncJob = (
  taskId: string,
  metadata: LinearSyncJobMetadata,
) => Promise<void>;

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
    private readonly continueJob?: ContinueLinearSyncJob,
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
      const round = await this.execute(metadata);
      const rounds = (metadata.rounds ?? 0) + 1;
      const result = mergeLinearSyncResults(metadata.result, round);
      if (metadata.kind === 'rule' && metadata.ruleId) {
        await LinearSyncRuleModel.recordRun(this.db, metadata.ruleId, this.scope, result);
      }
      // A rule run that hit its per-round cap goes on by itself, so the user
      // does not have to press Sync once per hundred issues. A round that
      // created nothing would only repeat itself, so the run stops there.
      if (
        this.continueJob &&
        metadata.kind === 'rule' &&
        round.truncated &&
        round.created > 0 &&
        rounds < LINEAR_SYNC_MAX_ROUNDS
      ) {
        log('sync %s continues (round %d, %d created so far)', taskId, rounds, result.created);
        await this.continueJob(taskId, { ...metadata, result, rounds });
        return;
      }
      await this.asyncTaskModel.update(taskId, {
        duration: Date.now() - startedAt,
        metadata: { ...metadata, result, rounds },
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
    return sync.syncByFilter(
      token,
      { linearProjectId: rule.linearProjectId, stateTypes: rule.stateTypes, teamId: rule.teamId },
      options,
    );
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
