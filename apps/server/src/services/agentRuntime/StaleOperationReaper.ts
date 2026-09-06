import type { AgentState } from '@lobechat/agent-runtime';
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
  /** Operations retired with a user-visible error (no state, or budget spent). */
  abandoned: number;
  /** Candidates whose lease was refreshed between select and claim. */
  alive: number;
  examined: number;
  /** Operations whose next step was re-queued. */
  redriven: number;
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
  ): Promise<'abandoned' | 'alive' | 'redriven'> {
    const operationId = candidate.id;
    const operationModel = new AgentOperationModel(
      this.db,
      candidate.userId,
      candidate.workspaceId ?? undefined,
    );

    // Read state before claiming: a run with no resumable state can never be
    // redriven, so spending an attempt on it would only delay the abandon.
    const state = await this.coordinator.loadAgentState(operationId).catch((e) => {
      log('[%s] state load failed, treating as unresumable: %O', operationId, e);
      return null;
    });

    if (!this.canRedrive(state) || !this.queueService) {
      await this.abandon(operationId, 'stale_lease_unresumable');
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

    // `stepCount` is the number of completed steps, so it is also the index of
    // the step that never finished. `executeStep` reloads everything else it
    // needs from this same state, which is why no context or payload has to be
    // reconstructed here.
    const stepIndex = state!.stepCount;

    await this.queueService.scheduleMessage({
      // Distinct per attempt: a shared key would let the provider dedupe a
      // genuinely needed second redrive away and strand the operation again.
      deduplicationId: `stale-redrive:${operationId}:${stepIndex}:${attempt}`,
      endpoint: urlJoin(this.baseURL, '/run'),
      operationId,
      priority: 'normal',
      retryDelay:
        typeof state!.metadata?.queueRetryDelay === 'string'
          ? state!.metadata.queueRetryDelay
          : undefined,
      retries:
        typeof state!.metadata?.queueRetries === 'number'
          ? state!.metadata.queueRetries
          : undefined,
      stepIndex,
    });

    log('[%s][%d] redriven (attempt %d/%d)', operationId, stepIndex, attempt, maxRedriveAttempts);
    return 'redriven';
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
