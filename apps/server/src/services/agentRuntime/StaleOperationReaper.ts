import type { AgentRuntimeContext, AgentState } from '@lobechat/agent-runtime';
import {
  isLocalHeterogeneousType,
  isLocalRuntimeHeterogeneousType,
  isRemoteHeterogeneousType,
} from '@lobechat/heterogeneous-agents';
import debug from 'debug';
import { and, asc, eq, gte, isNotNull, isNull, lt, notInArray, or, sql } from 'drizzle-orm';
import urlJoin from 'url-join';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { agentOperations, topics } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { AgentRuntimeCoordinator } from '@/server/modules/AgentRuntime/AgentRuntimeCoordinator';
import { deviceGateway } from '@/server/services/deviceGateway';
import { QueueService } from '@/server/services/queue';

import { AbandonOperationService } from './AbandonOperationService';
import { BACKGROUND_OPERATION_TRIGGERS } from './foregroundOperation';
import {
  HETERO_OPERATION_SILENCE_MS as HETERO_SILENCE_MS,
  OPERATION_LEASE_STALE_MS as DEFAULT_STALE_AFTER_MS,
} from './operationLease';
import { findRunDeviceRoute, RUNNER_DISCONNECTED_SILENCE_MS } from './runnerLiveness';

const log = debug('lobe-server:stale-operation-reaper');

/**
 * Redriving costs a real LLM call, so a step that dies deterministically
 * (poison payload, an input that reliably OOMs the host) must not be retried
 * forever. Past this budget the operation is abandoned with a user-visible
 * error instead.
 */
const DEFAULT_MAX_REDRIVE_ATTEMPTS = 3;

/** Bound the work of a single cron tick so one sweep cannot run long. */
const DEFAULT_LIMIT = 50;

/**
 * How far back the sweep looks for candidates.
 *
 * Without a floor the oldest-first scan never gets past rows nobody will ever
 * recover: production carries ~21k `running` rows whose lease froze more than a
 * day ago (the oldest from May), every one of them without coordinator state
 * and therefore `skipped`. The 50-row window was the same 50 dead rows on every
 * tick, so a run that died five minutes ago was never examined. Coordinator
 * state lives for two hours (`AgentStateManager` TTL), so nothing older than a
 * day can be redriven anyway, and a stateless heterogeneous run is retired well
 * inside it (see `HETERO_SILENCE_MS`).
 */
const DEFAULT_LOOKBACK_MS = 24 * 60 * 60_000;

/**
 * Oldest `created_at` a candidate may have, applied to both `running` scans.
 *
 * It is what lets them use the partial index
 * `agent_operations_running_created_at_idx`: without it they read every
 * `running` row through `agent_operations_status_idx` and discard all but a
 * few dozen, and the dead rows described above made each sweep read ~75k
 * blocks (8.8s mean in production). An index on `updated_at` would avoid the
 * bound, but every write bumps `updated_at` through `$onUpdate`, so it would
 * turn the table's HOT updates (62% of all updates) into full index rewrites;
 * `created_at` never changes. A week is far past any real run: over three days
 * of production rows the longest-lived `running` operation was ~5h.
 */
const DEFAULT_MAX_RUN_AGE_MS = 7 * 24 * 60 * 60_000;

const isHeterogeneousProvider = (provider: string | null | undefined): boolean =>
  !!provider &&
  (isLocalHeterogeneousType(provider) ||
    isRemoteHeterogeneousType(provider) ||
    isLocalRuntimeHeterogeneousType(provider));

/** Bound how many overlapping topics one sweep reports. */
const CONCURRENT_FOREGROUND_REPORT_LIMIT = 20;

export interface ReapStaleOperationsParams {
  /** Silence after which a stateless heterogeneous run is retired. */
  heteroSilenceMs?: number;
  limit?: number;
  /** Ignore rows whose lease froze longer ago than this. */
  lookbackMs?: number;
  maxRedriveAttempts?: number;
  /** Ignore rows created longer ago than this — see `DEFAULT_MAX_RUN_AGE_MS`. */
  maxRunAgeMs?: number;
  /** Silence after which a device-hosted run whose device is offline is retired. */
  runnerSilenceMs?: number;
  staleAfterMs?: number;
}

/** Which device ids one pool has connected; `undefined` when the gateway could not say. */
type DevicePresence = (userId: string, workspaceId?: string) => Promise<Set<string> | undefined>;

/** Why a run is retired; decides both the claim's completion reason and the turn's error. */
type AbandonReason = 'hetero_silent' | 'redrive_exhausted' | 'runner_disconnected';

export interface ReapStaleOperationsResult {
  /** Operations retired with a user-visible error (budget spent, or no context). */
  abandoned: number;
  /** Candidates whose lease was refreshed between select and claim. */
  alive: number;
  /**
   * Topics with two or more foreground runs `running` at once where an older
   * run was never asked to stop. Composer sends supersede the previous run, so
   * such an overlap means a start path slipped past that and both runs are
   * spending on the same conversation. An older run that already carries the
   * interrupt sentinel is only finishing its current step and is not counted,
   * nor is a run whose lease froze past the hetero silence window (dead).
   * Detection only: nothing is interrupted.
   */
  concurrentForegroundTopics: number;
  examined: number;
  /**
   * Candidates whose recovery threw (Redis, database or queue failure). Reported
   * so a sweep that recovered nothing is visible to whatever polls the endpoint,
   * rather than looking identical to a quiet tick.
   */
  failed: number;
  /** Operations whose next step was re-queued. */
  redriven: number;
  /** Candidates this sweep has no authority over — see `recover`. */
  skipped: number;
}

/**
 * Periodic recovery for operations whose executing host died mid-step.
 *
 * A serverless instance can be recycled while it owns a step. When that
 * happens nothing else notices: QStash already ACKed the delivery that started
 * the step (so it never redelivers), the step lock simply expires, and only
 * `services/goal` ever calls `settleStaleRunning` — a chat/bot/task operation
 * has no reaper at all. The row stays `running` forever and the conversation
 * freezes with no error and no way to resume.
 *
 * This sweep closes that hole from the durable side, and prefers *resuming*
 * over reporting: the runtime keeps its resumable state in Redis, so as long
 * as that state is still alive the correct recovery is to re-queue the next
 * step and let the run continue where it stopped. Only when the state is gone
 * (or the redrive budget is spent) does it fall back to abandoning the
 * operation with a visible error the user can retry from.
 *
 * Safety comes from three existing mechanisms rather than new bookkeeping:
 * - `claimStaleRedrive` consumes the candidate in the same UPDATE that selects
 *   it, so overlapping ticks cannot both re-queue one step.
 * - `tryClaimStep` arbitrates against a host that turns out to be alive after
 *   all: the redelivered step loses the lock race and returns without running.
 * - `executeStep` ACKs deliveries for operations already in a terminal state,
 *   so a redrive that races a completion is a no-op.
 */
export class StaleOperationReaper {
  private readonly coordinator: AgentRuntimeCoordinator;
  private readonly queueService: QueueService | null;

  constructor(
    private readonly db: LobeChatDatabase,
    options?: { coordinator?: AgentRuntimeCoordinator; queueService?: QueueService | null },
  ) {
    this.coordinator = options?.coordinator ?? new AgentRuntimeCoordinator();
    this.queueService =
      options?.queueService === null ? null : (options?.queueService ?? new QueueService());
  }

  private get baseURL() {
    const baseUrl = process.env.AGENT_RUNTIME_BASE_URL || process.env.APP_URL;

    return urlJoin(baseUrl || 'http://localhost:3010', '/api/agent');
  }

  async sweep(params?: ReapStaleOperationsParams): Promise<ReapStaleOperationsResult> {
    const staleAfterMs = params?.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    const maxRedriveAttempts = params?.maxRedriveAttempts ?? DEFAULT_MAX_REDRIVE_ATTEMPTS;
    const limit = params?.limit ?? DEFAULT_LIMIT;
    const now = Date.now();
    const staleBefore = new Date(now - staleAfterMs);
    const heteroStaleBefore = new Date(now - (params?.heteroSilenceMs ?? HETERO_SILENCE_MS));
    const runnerSilentBefore = new Date(
      now - (params?.runnerSilenceMs ?? RUNNER_DISCONNECTED_SILENCE_MS),
    );
    const presence = this.createDevicePresence();
    const notBefore = new Date(now - (params?.lookbackMs ?? DEFAULT_LOOKBACK_MS));
    const createdAfter = new Date(now - (params?.maxRunAgeMs ?? DEFAULT_MAX_RUN_AGE_MS));

    const candidates = await this.listStaleRunning({ createdAfter, limit, notBefore, staleBefore });
    const result: ReapStaleOperationsResult = {
      abandoned: 0,
      alive: 0,
      concurrentForegroundTopics: 0,
      examined: candidates.length,
      failed: 0,
      redriven: 0,
      skipped: 0,
    };

    for (const candidate of candidates) {
      try {
        const outcome = await this.recover(candidate, {
          heteroStaleBefore,
          maxRedriveAttempts,
          presence,
          runnerSilentBefore,
          staleBefore,
        });
        result[outcome] += 1;
      } catch (e) {
        // One poisoned row must not abort the rest of the sweep.
        result.failed += 1;
        log('[%s] recovery failed: %O', candidate.id, e);
      }
    }

    try {
      result.concurrentForegroundTopics = await this.reportConcurrentForegroundRuns(
        heteroStaleBefore,
        createdAfter,
      );
    } catch (e) {
      log('concurrent foreground patrol failed: %O', e);
    }

    log('sweep done: %O', result);
    return result;
  }

  /**
   * Warn about topics where more than one foreground run is live. Top-level
   * runs only: sub-agent children (`parentOperationId`) and thread runs
   * (`threadId`) legitimately run beside the topic's main run.
   *
   * Only runs whose lease moved within the hetero silence window count. A
   * `running` row frozen longer than that is dead, not spending, and the
   * recovery above never settles a dead row past its lookback: unbounded, the
   * same months-old topics were re-reported on every once-a-minute sweep and
   * made up the bulk of production warn logs. Every live run refreshes its
   * lease well inside this window (90s heartbeat, or a hetero ingest batch).
   */
  private async reportConcurrentForegroundRuns(
    liveSince: Date,
    createdAfter: Date,
  ): Promise<number> {
    const rows = await this.db
      .select({
        operationIds: sql<
          string[]
        >`array_agg(${agentOperations.id} order by ${agentOperations.createdAt})`,
        topicId: agentOperations.topicId,
      })
      .from(agentOperations)
      .where(
        and(
          eq(agentOperations.status, 'running'),
          isNotNull(agentOperations.topicId),
          isNull(agentOperations.threadId),
          isNull(agentOperations.parentOperationId),
          gte(agentOperations.updatedAt, liveSince),
          // Index bound only — see DEFAULT_MAX_RUN_AGE_MS.
          gte(agentOperations.createdAt, createdAfter),
          or(
            isNull(agentOperations.trigger),
            notInArray(agentOperations.trigger, [...BACKGROUND_OPERATION_TRIGGERS]),
          ),
        ),
      )
      .groupBy(agentOperations.topicId)
      .having(sql`count(*) > 1`)
      .limit(CONCURRENT_FOREGROUND_REPORT_LIMIT);

    let reported = 0;
    for (const row of rows) {
      // The newest run is the one that should survive; an older run with the
      // sentinel set was stopped (Stop / Send now / supersede) and exits at its
      // next step boundary, which can be minutes into a long LLM call.
      const older = row.operationIds.slice(0, -1);
      const interrupted = await Promise.all(older.map((id) => this.coordinator.isInterrupted(id)));
      const unstopped = older.filter((_, index) => !interrupted[index]);
      if (unstopped.length === 0) continue;

      reported += 1;
      console.warn('[StaleOperationReaper] concurrent foreground operations on one topic', {
        ...row,
        unstoppedOperationIds: unstopped,
      });
    }

    return reported;
  }

  /**
   * Stale candidates across all tenants. Queried directly rather than through
   * `AgentOperationModel`, which is user-scoped by construction — this is a
   * system-level sweep, and the per-operation mutations below re-enter the
   * model with the row's own owner so ownership is still enforced where it
   * matters.
   */
  private async listStaleRunning({
    createdAfter,
    limit,
    notBefore,
    staleBefore,
  }: {
    createdAfter: Date;
    limit: number;
    notBefore: Date;
    staleBefore: Date;
  }) {
    return (
      this.db
        // Only what recovery needs: everything else about the run is read from
        // the coordinator state, and the abandon path re-reads the row itself.
        .select({
          id: agentOperations.id,
          provider: agentOperations.provider,
          topicId: agentOperations.topicId,
          updatedAt: agentOperations.updatedAt,
          userId: agentOperations.userId,
          workspaceId: agentOperations.workspaceId,
        })
        .from(agentOperations)
        .where(
          and(
            eq(agentOperations.status, 'running'),
            lt(agentOperations.updatedAt, staleBefore),
            // See DEFAULT_LOOKBACK_MS: without this floor the oldest-first
            // window is permanently filled by long-dead rows.
            gte(agentOperations.updatedAt, notBefore),
            // Index bound only — see DEFAULT_MAX_RUN_AGE_MS.
            gte(agentOperations.createdAt, createdAfter),
            // A never-heartbeated row is only meaningful once it is older than
            // the window too; `startedAt` is the lease's initial value.
            or(isNull(agentOperations.startedAt), lt(agentOperations.startedAt, staleBefore)),
          ),
        )
        // Oldest first: a backlog should drain in the order it accumulated, and
        // it keeps the tick deterministic when `limit` truncates.
        .orderBy(asc(agentOperations.updatedAt))
        .limit(limit)
    );
  }

  /**
   * Device presence for one sweep, read once per pool. Every device-hosted
   * candidate of one user would otherwise ask the gateway for the same list.
   */
  private createDevicePresence(): DevicePresence {
    const pools = new Map<string, Promise<Set<string> | undefined>>();
    return (userId, workspaceId) => {
      const key = `${userId}:${workspaceId ?? ''}`;
      let pool = pools.get(key);
      if (!pool) {
        pool = deviceGateway.queryConnectedDeviceIds(userId, workspaceId).catch(() => undefined);
        pools.set(key, pool);
      }
      return pool;
    };
  }

  /**
   * Whether the device that hosts a run is provably offline.
   *
   * The route comes from the topic's `runningOperation` marker, the same one a
   * Stop reads to reach the process. A marker that names no device (a cloud or
   * remote run, or a newer run on the topic) proves nothing. A marker written
   * before routes carried `deviceWorkspaceId` may belong to either the personal
   * pool or the run's workspace, so both are asked; the device counts as
   * offline only when every pool answered and none has it. A gateway that
   * cannot answer is never read as offline.
   */
  private async isRunnerDisconnected(
    candidate: { id: string; topicId: string | null; userId: string; workspaceId: string | null },
    presence: DevicePresence,
  ): Promise<boolean> {
    if (!candidate.topicId) return false;

    const [topic] = await this.db
      .select({ metadata: topics.metadata })
      .from(topics)
      .where(eq(topics.id, candidate.topicId))
      .limit(1);
    const route = findRunDeviceRoute(topic?.metadata?.runningOperation, candidate.id);
    if (!route) return false;

    const ownerId = route.deviceUserId ?? candidate.userId;
    const pools = route.deviceWorkspaceId
      ? [route.deviceWorkspaceId]
      : [...new Set([undefined, candidate.workspaceId ?? undefined])];

    for (const workspaceId of pools) {
      const connected = await presence(ownerId, workspaceId);
      if (!connected || connected.has(route.deviceId)) return false;
    }
    return true;
  }

  private async recover(
    candidate: {
      id: string;
      provider: string | null;
      topicId: string | null;
      updatedAt: Date;
      userId: string;
      workspaceId: string | null;
    },
    {
      heteroStaleBefore,
      maxRedriveAttempts,
      presence,
      runnerSilentBefore,
      staleBefore,
    }: {
      heteroStaleBefore: Date;
      maxRedriveAttempts: number;
      presence: DevicePresence;
      runnerSilentBefore: Date;
      staleBefore: Date;
    },
  ): Promise<'abandoned' | 'alive' | 'redriven' | 'skipped'> {
    const operationId = candidate.id;
    const operationModel = new AgentOperationModel(
      this.db,
      candidate.userId,
      candidate.workspaceId ?? undefined,
    );

    // Everything that decides *whether* to act is read before the claim, so a
    // candidate this sweep cannot help never consumes an attempt.
    const state = await this.coordinator.loadAgentState(operationId).catch((e) => {
      log('[%s] state load failed, treating as unresumable: %O', operationId, e);
      return null;
    });

    // No coordinator state means this sweep has no authority over the run.
    // Crucially that is the shape of a *healthy* heterogeneous operation: a
    // Claude Code / Codex run is driven by an external CLI, never creates
    // coordinator state, and only refreshes its lease when `heteroIngest`
    // batches arrive — so a single long tool call reads as "stale" here.
    // Retiring one would be actively destructive rather than merely useless:
    // `heteroIngest` bails out on `touchRunning` returning false, so every
    // subsequent batch of a live session would be dropped before persistence.
    //
    // So a stateless heterogeneous run is only retired once it has been silent
    // for the full hetero window — the same window the agent-gateway inactivity
    // watchdog uses. That watchdog used to be the only thing that ever ended
    // such a run, and it does not always fire: on 2026-10-12 two Codex runs on
    // one desktop went silent in the same minute; one was abandoned after an
    // hour, the other stayed `running` (its Task refusing every new message as
    // "Topic is already running") until the user paused it, and dozens more
    // hetero rows have sat `running` for days. This is the server-side backstop.
    // `abandonIfStillStale` re-checks the lease inside its UPDATE, so a batch
    // that lands meanwhile keeps the run alive.
    if (!state) {
      if (!isHeterogeneousProvider(candidate.provider)) return 'skipped';

      const silentSince = new Date(candidate.updatedAt).getTime();
      if (silentSince < heteroStaleBefore.getTime()) {
        return this.abandonIfStillStale(
          operationModel,
          operationId,
          heteroStaleBefore,
          'hetero_silent',
        );
      }

      // Inside the silence window a quiet run may just be in a long tool call,
      // so silence alone proves nothing yet. A device-hosted run whose device
      // has gone offline is different: the runner that would report it is not
      // there (the desktop app was closed, the `lh connect` daemon died), so
      // waiting out the rest of the hour only keeps the topic stuck.
      if (
        silentSince < runnerSilentBefore.getTime() &&
        (await this.isRunnerDisconnected(candidate, presence))
      ) {
        return this.abandonIfStillStale(
          operationModel,
          operationId,
          runnerSilentBefore,
          'runner_disconnected',
        );
      }

      return 'skipped';
    }

    // Any other stateless operation is left alone: this sweep only acts on
    // runs it can resume or can prove dead.
    if (!this.queueService) return 'skipped';

    // Parked operations have their own resume paths; a plain step would run
    // past whatever they are waiting on.
    if (!this.canRedrive(state)) return 'skipped';

    // `stepCount` is the number of completed steps, so it is also the index of
    // the step that never finished.
    const stepIndex = state.stepCount;

    // The context is NOT optional in practice. `runtime.step` falls back to
    // `createInitialContext(state)` when it gets none, which re-enters the run
    // at `user_input` — so a step that owed a `tool_result` / graph
    // continuation would instead start a fresh LLM turn and silently drop the
    // pending work. Recover the real one, and refuse to redrive without it:
    // abandoning with a visible error is recoverable, corrupting the run is
    // not.
    const context = await this.resolveRedriveContext(operationId, state, stepIndex);
    if (!context) {
      // Skipped rather than abandoned, because "no context" is not a reliable
      // signal: `AgentStateManager.getExecutionHistory` swallows a failed
      // LRANGE or a JSON parse error and returns an empty array, so a
      // transient Redis blip is indistinguishable here from a genuinely
      // missing entry. Retiring an operation is irreversible and user-visible,
      // and this one is otherwise resumable — a later tick may well recover it
      // once the read succeeds, and the inactivity watchdog still declares it
      // dead if it never does.
      log('[%s][%d] no persisted context to resume from', operationId, stepIndex);
      return 'skipped';
    }

    const attempt = await operationModel.claimStaleRedrive(
      operationId,
      staleBefore,
      maxRedriveAttempts,
    );

    if (attempt === null) {
      // Either a heartbeat landed while we were reading state (the step is
      // alive and owns itself again) or the redrive budget is spent. The CAS
      // below distinguishes them without a separate read: only a row that is
      // still both running and past its lease can be retired.
      return this.abandonIfStillStale(
        operationModel,
        operationId,
        staleBefore,
        'redrive_exhausted',
      );
    }

    try {
      await this.queueService.scheduleMessage({
        context,
        // Distinct per attempt: a shared key would let the provider dedupe a
        // genuinely needed second redrive away and strand the operation again.
        deduplicationId: `stale-redrive:${operationId}:${stepIndex}:${attempt}`,
        endpoint: urlJoin(this.baseURL, '/run'),
        operationId,
        priority: 'normal',
        retryDelay:
          typeof state.metadata?.queueRetryDelay === 'string'
            ? state.metadata.queueRetryDelay
            : undefined,
        retries:
          typeof state.metadata?.queueRetries === 'number'
            ? state.metadata.queueRetries
            : undefined,
        stepIndex,
      });
    } catch (e) {
      // The attempt was claimed before publishing, because the claim is also
      // the mutual exclusion between overlapping sweeps. Publishing is what it
      // was claimed *for*, so a failure has to give it back — the budget
      // bounds LLM spend, and nothing was spent. Without this, a brief queue
      // outage walks a healthy operation to its limit and retires it having
      // never attempted a single recovery.
      await operationModel.releaseStaleRedrive(operationId, attempt).catch((releaseError) => {
        log('[%s] failed to release redrive attempt %d: %O', operationId, attempt, releaseError);
      });
      throw e;
    }

    log('[%s][%d] redriven (attempt %d/%d)', operationId, stepIndex, attempt, maxRedriveAttempts);
    return 'redriven';
  }

  /**
   * The context the interrupted step should have received.
   *
   * Step 0 carries the context the operation was created with, which the
   * runtime persists onto the state — the same field the intervention
   * continuation re-publishes from. Every later step is driven by the
   * `nextContext` its predecessor produced, which `saveStepResult` stores
   * alongside the step in the execution history under the *producing* step's
   * index (so step N's entry holds the context for step N+1).
   *
   * Returns undefined rather than a synthesized fallback: the caller must be
   * able to tell "resume correctly" from "cannot resume".
   */
  private async resolveRedriveContext(
    operationId: string,
    state: AgentState,
    stepIndex: number,
  ): Promise<AgentRuntimeContext | undefined> {
    if (stepIndex === 0) {
      return (state as AgentState & { initialContext?: AgentRuntimeContext }).initialContext;
    }

    try {
      const history = await this.coordinator.getExecutionHistory(operationId);
      const producer = history.find(
        (entry: { context?: AgentRuntimeContext; stepIndex?: number }) =>
          entry?.stepIndex === stepIndex - 1,
      );

      return producer?.context;
    } catch (e) {
      log('[%s][%d] execution history lookup failed: %O', operationId, stepIndex, e);
      return undefined;
    }
  }

  /**
   * Whether the runtime state can still carry a resumed step.
   *
   * `idle` counts alongside `running`: it is the status a state carries
   * between its creation and the first step, which is exactly the shape of an
   * operation whose step-0 delivery never executed (the row is `running` with
   * no steps, no snapshot and no messages beyond the user turn). Those are
   * resumable for the same reason a mid-run death is — the state describes a
   * step that still needs to happen.
   *
   * Parked operations are excluded on purpose: `waiting_for_human` and
   * `waiting_for_async_tool` are deliberate pauses with their own resume
   * paths, and re-queueing a plain step would run past the thing they wait on.
   * Terminal statuses are excluded because there is nothing left to run.
   */
  private canRedrive(state: AgentState | null): state is AgentState {
    return (
      !!state &&
      (state.status === 'running' || state.status === 'idle') &&
      typeof state.stepCount === 'number' &&
      state.stepCount >= 0
    );
  }

  /**
   * Retire an operation, but only if it is *still* past its lease at this
   * instant.
   *
   * Abandonment is irreversible and user-visible — it settles the durable row,
   * errors the conversation tail and clears the topic's running pointer — so it
   * must never act on a stale read. Minutes can pass between
   * `listStaleRunning` selecting a candidate and this line running (the sweep
   * walks candidates serially, and reading state plus execution history costs
   * two Redis round trips each), which is ample room for the worker to resume
   * and heartbeat. A transiently empty history read reaches here the same way.
   *
   * `settleStaleRunning` is the compare-and-set that closes it: its WHERE
   * clause re-checks `status = 'running' AND updatedAt < staleBefore` inside
   * the UPDATE, so a heartbeat that landed in the meantime wins and this
   * returns `alive` untouched. Only once the row is claimed do the
   * irreversible side effects run.
   */
  private async abandonIfStillStale(
    operationModel: AgentOperationModel,
    operationId: string,
    staleBefore: Date,
    reason: AbandonReason,
  ): Promise<'abandoned' | 'alive'> {
    const claimed =
      reason === 'runner_disconnected'
        ? await operationModel.settleDisconnectedRunner(operationId, staleBefore)
        : await operationModel.settleStaleRunning(operationId, staleBefore);
    if (!claimed) {
      log('[%s] lease was refreshed before abandon could claim it', operationId);
      return 'alive';
    }

    // The claim above already moved the row to `abandoned`; tell the lifecycle
    // so it persists onto that status instead of being refused as a conflicting
    // terminal owner — which would skip `onComplete` / `onError` and leave
    // hook consumers (tasks, bots, parent runs) waiting on a retired operation.
    await new AbandonOperationService(this.db).finalizeAbandoned(
      operationId,
      reason === 'runner_disconnected' ? reason : `stale_lease_${reason}`,
      { settledAsAbandoned: true },
    );
    log('[%s] abandoned (reason=%s)', operationId, reason);

    return 'abandoned';
  }
}
