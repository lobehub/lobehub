import type {
  LinearSyncJobErrorCode,
  LinearSyncJobMetadata,
  LinearSyncJobView,
  LinearSyncResult,
} from '@lobechat/types';
import { AsyncTaskStatus } from '@lobechat/types';
import debug from 'debug';

import type { LinearSyncJobRow } from '@/database/models/linear';
import { LinearSyncJobModel, LinearSyncRuleModel } from '@/database/models/linear';
import { ProjectModel } from '@/database/models/project';
import type { LobeChatDatabase } from '@/database/type';

import { LinearApiError } from './client';
import type { LinearFilterSyncResult } from './issueSync';
import { LinearIssueSyncService, MAX_SKIPPED_ENTRIES } from './issueSync';
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
 * How long one request may keep running rounds before it hands the run to a
 * new request; inside the async route's time limit (800s on Vercel). A round
 * starts only when twice the slowest round so far still fits, so a slow
 * round near the end goes to a fresh request instead of being cut off.
 */
export const LINEAR_SYNC_RUN_BUDGET_MS = 12 * 60 * 1000;
/**
 * Times one rule run may hand itself to a new request. Every hand-off extends
 * a chain of requests started by the user's click, and Vercel never delivered
 * a fifth one: four requests in all. A run that would need more ends as
 * finished with issues left (`truncated`), and the next Sync carries on.
 */
export const LINEAR_SYNC_MAX_HAND_OFFS = 3;

/**
 * The outcome of a run that took several rounds. What a round wrote happens
 * once and adds up. A round that resumed at a cursor saw only issues after the
 * earlier ones, so what it looked at (unchanged, kept edits, skipped) adds up
 * too; a round that read from the start saw everything again, so those counts
 * come from it alone.
 */
export const mergeLinearSyncResults = (
  previous: LinearSyncResult | undefined,
  latest: LinearSyncResult,
  { resumed }: { resumed: boolean },
): LinearSyncResult => {
  if (!previous) return latest;
  const archived = (previous.archived ?? 0) + (latest.archived ?? 0);
  const commentsImported = (previous.commentsImported ?? 0) + (latest.commentsImported ?? 0);
  const labelsSynced = (previous.labelsSynced ?? 0) + (latest.labelsSynced ?? 0);
  const written = {
    ...(archived ? { archived } : {}),
    closed: previous.closed + latest.closed,
    ...(commentsImported ? { commentsImported } : {}),
    created: previous.created + latest.created,
    ...(labelsSynced ? { labelsSynced } : {}),
    updated: previous.updated + latest.updated,
  };
  if (!resumed) return { ...latest, ...written };
  return {
    ...latest,
    ...written,
    keptLocalEdits: previous.keptLocalEdits + latest.keptLocalEdits,
    skipped: [...previous.skipped, ...latest.skipped].slice(0, MAX_SKIPPED_ENTRIES),
    skippedCount:
      (previous.skippedCount ?? previous.skipped.length) +
      (latest.skippedCount ?? latest.skipped.length),
    unchanged: previous.unchanged + latest.unchanged,
  };
};

/**
 * Where a rule run goes after a round: on from a cursor while it keeps
 * finding issues, then once more from the start, which picks up issues Linear
 * moved ahead of the cursor meanwhile and closes tasks whose issue was closed.
 * `undefined`: the run is done.
 */
export const nextLinearSyncRound = (
  startAfter: string | undefined,
  round: LinearFilterSyncResult,
): { cursor?: string; sweep?: true } | undefined => {
  if (round.truncated) {
    const moved = round.resumeAfter !== undefined && round.resumeAfter !== startAfter;
    // A round that neither created nor moved on would only repeat itself.
    return round.created > 0 || moved ? { cursor: round.resumeAfter } : undefined;
  }
  return startAfter === undefined ? undefined : { sweep: true };
};

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
    // A running job may carry `canceled`: its stop was requested and its
    // current round is finishing.
    error: stale
      ? 'timeout'
      : row.status === AsyncTaskStatus.Error
        ? (error ?? 'failed')
        : error === 'canceled'
          ? 'canceled'
          : null,
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
) => Promise<boolean>;

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
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
    private readonly continueJob?: ContinueLinearSyncJob,
    /** How long this request keeps starting rounds before handing the run on. */
    private readonly runBudgetMs: number = LINEAR_SYNC_RUN_BUDGET_MS,
    /** How many times one run may be handed to a new request. */
    private readonly maxHandOffs: number = LINEAR_SYNC_MAX_HAND_OFFS,
  ) {}

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
    // Every write below applies only while the job is still running and no
    // stop was requested; a run stopped meanwhile ends as stopped.
    // A failed round fails the job, unless the user stopped it meanwhile:
    // then it ends as stopped.
    const fail = async (code: LinearSyncJobErrorCode) => {
      const duration = Date.now() - startedAt;
      const failed = await LinearSyncJobModel.transition(
        this.db,
        this.scope,
        taskId,
        [AsyncTaskStatus.Processing],
        { duration, error: { code }, status: AsyncTaskStatus.Error },
      );
      if (!failed)
        await LinearSyncJobModel.settleStopped(this.db, this.scope, taskId, { duration });
    };
    // Rounds run here, one after another, while the run is within its time
    // budget. Handing every round to a new async request instead nests each
    // request inside the previous one (it waits for the next), and the host
    // refuses a chain a few requests deep (Vercel: 508 INFINITE_LOOP_DETECTED),
    // which left the run queued until it showed as cut off.
    let current = metadata;
    try {
      let slowestRound = 0;
      for (;;) {
        const roundStartedAt = Date.now();
        const round = await this.execute(current);
        slowestRound = Math.max(slowestRound, Date.now() - roundStartedAt);
        const roundResult = withoutResumePoint(round);
        const rounds = (current.rounds ?? 0) + 1;
        const result = mergeLinearSyncResults(current.result, roundResult, {
          resumed: current.cursor !== undefined,
        });
        // A rule run that hit its per-round cap goes on by itself, so the user
        // does not have to press Sync once per hundred issues.
        const proposed =
          this.continueJob && current.kind === 'rule'
            ? nextLinearSyncRound(current.cursor, round)
            : undefined;
        const next = withinRoundCap(proposed, rounds, current.cursor !== undefined);
        const outcome = {
          ...current,
          cursor: undefined,
          handOffs: undefined,
          reconcileOnly: undefined,
          result,
          rounds,
        };
        if (next) {
          const following: LinearSyncJobMetadata = {
            ...current,
            cursor: next.cursor,
            // Past the cap, the closing pass creates nothing, so the cap holds.
            reconcileOnly: rounds >= LINEAR_SYNC_MAX_ROUNDS || undefined,
            result,
            rounds,
          };
          log('sync %s continues (round %d, %d created so far)', taskId, rounds, result.created);
          if (Date.now() - startedAt + 2 * slowestRound < this.runBudgetMs) {
            // Record the total so far, which also checks no stop was requested.
            const kept = await LinearSyncJobModel.transition(
              this.db,
              this.scope,
              taskId,
              [AsyncTaskStatus.Processing],
              { metadata: following },
            );
            if (kept) {
              current = following;
              continue;
            }
            await LinearSyncJobModel.settleStopped(this.db, this.scope, taskId, {
              duration: Date.now() - startedAt,
              metadata: outcome,
            });
            return;
          }
          // Out of time: a new request takes the next round, unless the chain
          // of requests is as long as the host lets it get. Then the run ends
          // here with issues left, and the next Sync starts a new chain.
          const handOffs = current.handOffs ?? 0;
          if (handOffs < this.maxHandOffs) {
            const queued = await this.continueJob!(taskId, {
              ...following,
              handOffs: handOffs + 1,
            });
            if (queued) return;
          } else {
            log('sync %s stops after %d hand-offs, issues left', taskId, handOffs);
          }
        }
        // The rule shows its last finished run; a round in between, or a run
        // stopped part-way, leaves the previous one in place. The job turns
        // successful together with that record, or neither changes and the
        // failure below marks the job failed.
        const succeeded = await this.db.transaction(async (tx) => {
          const done = await LinearSyncJobModel.transition(
            tx,
            this.scope,
            taskId,
            [AsyncTaskStatus.Processing],
            {
              duration: Date.now() - startedAt,
              metadata: outcome,
              status: AsyncTaskStatus.Success,
            },
          );
          if (done && current.kind === 'rule' && current.ruleId) {
            await LinearSyncRuleModel.recordRun(tx, current.ruleId, this.scope, result);
          }
          return done;
        });
        if (!succeeded) {
          await LinearSyncJobModel.settleStopped(this.db, this.scope, taskId, {
            duration: Date.now() - startedAt,
            metadata: outcome,
          });
        }
        return;
      }
    } catch (error) {
      const code = toErrorCode(error);
      log('sync %s failed (%s): %O', taskId, code, error);
      await fail(code);
    } finally {
      clearInterval(heartbeat);
    }
  }

  private get scope() {
    return { userId: this.userId, workspaceId: this.workspaceId ?? null };
  }

  private async execute(
    metadata: LinearSyncJobMetadata,
  ): Promise<LinearSyncResult | LinearFilterSyncResult> {
    const scope = this.scope;
    // The project may have been deleted or hidden since the job was queued.
    const project = await new ProjectModel(this.db, this.userId, this.workspaceId).findById(
      metadata.projectId,
    );
    if (!project) throw new LinearSyncJobError('unavailable');

    const sync = new LinearIssueSyncService(this.db, this.userId, this.workspaceId);
    const options = {
      syncComments: metadata.syncComments,
      syncLabels: metadata.syncLabels,
      targetProjectId: metadata.projectId,
    };

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
      {
        includeArchived: metadata.includeArchived,
        linearProjectId: rule.linearProjectId,
        stateTypes: rule.stateTypes,
        teamId: rule.teamId,
      },
      { ...options, noCreate: metadata.reconcileOnly, startAfter: metadata.cursor },
    );
  }
}

/**
 * The next round, once the creating rounds may have used up the cap. The
 * closing pass from the start is not a creating round: a run that stops at the
 * cap after reading on from a cursor still takes it, so it never ends without
 * checking the issues it linked earlier. A round that read from the start has
 * already done that pass, so the run ends there, asking to be run again if
 * issues remain.
 */
export const withinRoundCap = (
  proposed: { cursor?: string; sweep?: true } | undefined,
  rounds: number,
  resumed: boolean,
): { cursor?: string; sweep?: true } | undefined => {
  if (!proposed || proposed.sweep || rounds < LINEAR_SYNC_MAX_ROUNDS) return proposed;
  return resumed ? { sweep: true } : undefined;
};

/** A round's outcome as stored and shown; the resume point travels in the job's `cursor`. */
const withoutResumePoint = (round: LinearFilterSyncResult): LinearSyncResult => {
  const result = { ...round };
  delete result.resumeAfter;
  return result;
};

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
