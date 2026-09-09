import type { AgentRuntimeContext, AgentState } from '@lobechat/agent-runtime';
import debug from 'debug';
import { and, asc, eq, isNull, lt, or } from 'drizzle-orm';
import urlJoin from 'url-join';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { agentOperations } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { AgentRuntimeCoordinator } from '@/server/modules/AgentRuntime/AgentRuntimeCoordinator';
import { QueueService } from '@/server/services/queue';

import { AbandonOperationService } from './AbandonOperationService';

const log = debug('lobe-server:stale-operation-reaper');

/**
 * How long an operation may go without refreshing its durable liveness lease
 * before this sweep treats it as dead.
 *
 * `AgentRuntimeService.startStepLockHeartbeat` touches the row every
 * `STEP_LOCK_HEARTBEAT_MS * DURABLE_LEASE_HEARTBEAT_EVERY_TICKS` = 90s while a
 * step holds the step lock, so five minutes is three missed beats: comfortably
 * past jitter, and far tighter than the 30-minute in-flight window the gateway
 * watchdog has to use (it can only reason about stream events, which stop for
 * legitimately slow first-token latency too).
 */
const DEFAULT_STALE_AFTER_MS = 5 * 60_000;

/**
 * Redriving costs a real LLM call, so a step that dies deterministically
 * (poison payload, an input that reliably OOMs the host) must not be retried
 * forever. Past this budget the operation is abandoned with a user-visible
 * error instead.
 */
const DEFAULT_MAX_REDRIVE_ATTEMPTS = 3;

/** Bound the work of a single cron tick so one sweep cannot run long. */
const DEFAULT_LIMIT = 50;

export interface ReapStaleOperationsParams {
  limit?: number;
  maxRedriveAttempts?: number;
  staleAfterMs?: number;
}

export interface ReapStaleOperationsResult {
  /** Operations retired with a user-visible error (budget spent, or no context). */
  abandoned: number;
  /** Candidates whose lease was refreshed between select and claim. */
  alive: number;
  examined: number;
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
    const staleBefore = new Date(Date.now() - staleAfterMs);

    const candidates = await this.listStaleRunning(staleBefore, limit);
    const result: ReapStaleOperationsResult = {
      abandoned: 0,
      alive: 0,
      examined: candidates.length,
      redriven: 0,
      skipped: 0,
    };

    for (const candidate of candidates) {
      try {
        const outcome = await this.recover(candidate, staleBefore, maxRedriveAttempts);
        result[outcome] += 1;
      } catch (e) {
        // One poisoned row must not abort the rest of the sweep.
        log('[%s] recovery failed: %O', candidate.id, e);
      }
    }

    log('sweep done: %O', result);
    return result;
  }

  /**
   * Stale candidates across all tenants. Queried directly rather than through
   * `AgentOperationModel`, which is user-scoped by construction — this is a
   * system-level sweep, and the per-operation mutations below re-enter the
   * model with the row's own owner so ownership is still enforced where it
   * matters.
   */
  private async listStaleRunning(staleBefore: Date, limit: number) {
    return (
      this.db
        // Only what recovery needs: everything else about the run is read from
        // the coordinator state, and the abandon path re-reads the row itself.
        .select({
          id: agentOperations.id,
          userId: agentOperations.userId,
          workspaceId: agentOperations.workspaceId,
        })
        .from(agentOperations)
        .where(
          and(
            eq(agentOperations.status, 'running'),
            lt(agentOperations.updatedAt, staleBefore),
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

  private async recover(
    candidate: { id: string; userId: string; workspaceId: string | null },
    staleBefore: Date,
    maxRedriveAttempts: number,
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
    // Stateless-but-genuinely-dead operations are the inactivity watchdog's
    // job (it reaches them through `finalize-abandoned`), and it has the
    // gateway-side evidence to tell the two apart. This sweep deliberately
    // limits itself to runs it can actually resume.
    if (!state || !this.queueService) return 'skipped';

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
      log('[%s][%d] no persisted context to resume from', operationId, stepIndex);
      await this.abandon(operationId, 'stale_lease_context_unavailable');
      return 'abandoned';
    }

    const attempt = await operationModel.claimStaleRedrive(
      operationId,
      staleBefore,
      maxRedriveAttempts,
    );

    if (attempt === null) {
      // Either a heartbeat landed while we were reading state (the step is
      // alive and owns itself again), or the redrive budget is spent. Only the
      // latter should be retired, so re-read the row to tell them apart
      // instead of guessing.
      const row = await operationModel.findById(operationId);
      const stale = row?.status === 'running' && row.updatedAt < staleBefore;
      if (!stale) return 'alive';

      await this.abandon(operationId, 'stale_lease_redrive_exhausted');
      return 'abandoned';
    }

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
        typeof state.metadata?.queueRetries === 'number' ? state.metadata.queueRetries : undefined,
      stepIndex,
    });

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

  private async abandon(operationId: string, reason: string): Promise<void> {
    await new AbandonOperationService(this.db).finalizeAbandoned(operationId, reason);
    log('[%s] abandoned (reason=%s)', operationId, reason);
  }
}
