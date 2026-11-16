import type { AgentState } from '@lobechat/agent-runtime';
import debug from 'debug';

import { type AgentExecutionParams, type AgentExecutionResult } from '../../types';
import { STEP_LOCK_RETRY_MAX_ATTEMPTS } from '../constants';
import { isShareRunRevoked } from '../shareRunGate';
import { loadTerminalDurableStatus } from '../terminalStatus';
import type { AgentRuntimeServiceContext } from '../types';
import { stepLockRetryDelayMs } from '../utils';

const log = debug('lobe-server:agent-runtime-service');

/** What this module reads off the service. */
export type StepGuardsDeps = Pick<
  AgentRuntimeServiceContext,
  | 'agentOperationModel'
  | 'baseURL'
  | 'buildShareAbortResult'
  | 'completionLifecycle'
  | 'coordinator'
  | 'delegate'
  | 'determineCompletionReason'
  | 'expireClientLlmWait'
  | 'handleGroupMemberTimeout'
  | 'queueService'
  | 'recordInterventionLifecycleCompletion'
  | 'shouldReplayPendingInterventionLifecycle'
  | 'traceRecorder'
  | 'tryResumeParentFromAsyncTool'
>;

/**
 * Deliveries that execute nothing and never claim the step lock: a group
 * member's deadline, a client wait's expiry, a terminal durable operation and
 * the async-tool barrier watchdog. Returns the delivery's result, or
 * `undefined` when the step has to run.
 */
export async function runLockFreeDelivery(
  deps: StepGuardsDeps,
  params: AgentExecutionParams,
): Promise<AgentExecutionResult | undefined> {
  const {
    asyncToolVerifyAttempt,
    clientLlmWaitExpired,
    groupMemberTimeout,
    operationId,
    stepIndex,
    verifyAsyncToolBarrier,
  } = params;

  // Group member timeout watchdog: enforce a member's deadline without claiming
  // the step lock. No-op if the member already finished; otherwise interrupt it
  // and bridge a `timeout` completion so the parked supervisor resumes/finishes.
  if (groupMemberTimeout) {
    return deps.handleGroupMemberTimeout(groupMemberTimeout);
  }

  // Expiry check of a `waiting_for_client` park. It executes nothing: the CAS
  // on the durable row decides whether the wait (still parked, same park) ends
  // here or a resume already took the run. Ahead of the terminal-row guard
  // below, because a retried expiry whose first attempt settled the row but
  // failed to finish must still get to finish it.
  if (clientLlmWaitExpired) {
    const expired = await deps.expireClientLlmWait(operationId, clientLlmWaitExpired);
    return {
      nextStepScheduled: false,
      state: expired ? { status: 'error' } : {},
      stepResult: null,
      success: true,
    };
  }

  // Redis keeps the resumable step state, but the durable operation row is
  // the authority for cancellation/recovery. A queued QStash delivery can
  // outlive a crashed process and arrive after Goal recovery has atomically
  // marked that operation interrupted. ACK it without touching the old
  // topic; otherwise the abandoned attempt can finish concurrently with its
  // replacement and submit a second Acceptance run.
  const durableTerminalStatus = await loadTerminalDurableStatus(
    deps.agentOperationModel,
    operationId,
    stepIndex,
  );
  if (durableTerminalStatus) {
    log(
      '[%s][%d] Skipping delivery for terminal durable operation (%s)',
      operationId,
      stepIndex,
      durableTerminalStatus,
    );
    return {
      nextStepScheduled: false,
      state: {
        status: durableTerminalStatus === 'abandoned' ? 'interrupted' : durableTerminalStatus,
      },
      stepResult: null,
      success: true,
    };
  }

  // Watchdog re-check for a parked async-tool wait: re-run the barrier + CAS
  // without claiming the step lock or executing anything. Idempotent — the
  // CAS guarantees at most one real resume regardless of how many checks run.
  // Opt back into `scheduleVerifyOnHold` with the next attempt so an
  // unsatisfied barrier re-arms (bounded backoff) instead of giving up after
  // a single shot — bounded watchdog retry ensures transient misses are recovered.
  if (verifyAsyncToolBarrier) {
    const attempt = asyncToolVerifyAttempt ?? 1;
    log('[%s][%d] Running async-tool barrier verify (attempt %d)', operationId, stepIndex, attempt);
    const resumed = await deps.tryResumeParentFromAsyncTool(
      { parentOperationId: operationId },
      { scheduleVerifyOnHold: true, verifyAttempt: attempt + 1 },
    );
    return {
      nextStepScheduled: resumed,
      state: {},
      stepResult: null,
      success: true,
    };
  }

  return undefined;
}

/**
 * Another delivery holds the step lock. ACK a stale duplicate, ask for a
 * redelivery of a still-locked lifecycle replay, or re-queue this delivery on
 * the bounded lock backoff.
 */
export async function handleStepLockConflict(
  deps: StepGuardsDeps,
  params: AgentExecutionParams,
): Promise<AgentExecutionResult> {
  const {
    approvedToolCall,
    context,
    externalRetryCount = 0,
    finishAfterAsyncTool,
    humanInput,
    lockRetryAttempt = 0,
    operationId,
    rejectAndContinue,
    rejectionReason,
    resumeAsyncTool,
    resumeClientLlm,
    stepIndex,
    toolMessageId,
  } = params;

  // Someone else owns this operation now. Whatever this invocation buffered
  // for the trace belongs to their partial from here — every return below
  // leaves without it, so drop it once, up front, rather than per exit.
  deps.traceRecorder.discardPartial();

  let currentState: AgentState | null | undefined = null;
  try {
    currentState = await deps.coordinator.loadAgentState(operationId);
  } catch (error) {
    log(
      '[%s][%d] Failed to load state while handling step lock conflict: %O',
      operationId,
      stepIndex,
      error,
    );
  }

  const currentStepCount = currentState?.stepCount;
  if (currentState && typeof currentStepCount === 'number' && currentStepCount > stepIndex) {
    if (
      deps.shouldReplayPendingInterventionLifecycle(currentState, stepIndex, externalRetryCount)
    ) {
      // This is a retry of a completed human-approval step whose Review
      // lifecycle did not finish. Do not ACK it while another delivery still
      // owns the step lock: once that owner releases the lock, QStash must
      // redeliver so the lifecycle-only replay below can publish the Review.
      log(
        '[%s][%d] Pending intervention lifecycle retry is still locked; requesting redelivery',
        operationId,
        stepIndex,
      );
      return {
        locked: true,
        nextStepScheduled: false,
        state: currentState,
        success: false,
      };
    }

    log(
      '[%s][%d] Step lock conflict is stale (stepCount=%d), skipping',
      operationId,
      stepIndex,
      currentStepCount,
    );
    return {
      nextStepScheduled: false,
      state: currentState,
      stepResult: null,
      success: true,
    };
  }

  // The lock is held by a live step of this operation, and this delivery is
  // not a stale duplicate — it still has to run once the holder is done.
  //
  // Don't lean on the queue's own retry budget for that wait: the lock is
  // heartbeat-refreshed for as long as the holding step runs (unbounded),
  // while the budget is a handful of fixed-delay retries. A step that runs
  // longer than the budget therefore exhausts it and the delivery is
  // dead-lettered — the step it carried is then never executed. Re-queue a
  // fresh delivery on our own bounded backoff instead, and ACK this one.
  //
  // The re-delivery has to carry this delivery's own resume/intervention
  // payload: a human-intervention resume (`processHumanIntervention`) or an
  // async-tool resume (`tryResumeParentFromAsyncTool`) can lose the lock
  // race too, and re-queueing only the retry counter would run a plain step
  // once the lock clears — silently dropping the approval / human input, or
  // leaving a parked operation parked forever. Undefined fields drop out of
  // the JSON body, so unrelated deliveries still send just the counter.
  const nextLockRetryAttempt = lockRetryAttempt + 1;
  if (deps.queueService && nextLockRetryAttempt <= STEP_LOCK_RETRY_MAX_ATTEMPTS) {
    const delay = stepLockRetryDelayMs(nextLockRetryAttempt);
    log(
      '[%s][%d] Step lock conflict — re-queueing attempt %d/%d in %dms',
      operationId,
      stepIndex,
      nextLockRetryAttempt,
      STEP_LOCK_RETRY_MAX_ATTEMPTS,
      delay,
    );

    try {
      await deps.queueService.scheduleMessage({
        context,
        delay,
        endpoint: `${deps.baseURL}/run`,
        operationId,
        payload: {
          approvedToolCall,
          finishAfterAsyncTool,
          humanInput,
          lockRetryAttempt: nextLockRetryAttempt,
          rejectAndContinue,
          rejectionReason,
          resumeAsyncTool,
          resumeClientLlm,
          toolMessageId,
        },
        priority: 'high',
        retryDelay:
          typeof currentState?.host?.queue?.retryDelay === 'string'
            ? currentState.host?.queue?.retryDelay
            : undefined,
        retries:
          typeof currentState?.host?.queue?.retries === 'number'
            ? currentState.host?.queue?.retries
            : undefined,
        stepIndex,
      });

      return {
        locked: true,
        lockRescheduled: true,
        nextStepScheduled: true,
        state: {},
        success: true,
      };
    } catch (error) {
      // Fall through to the retryable response so the delivery isn't lost.
      log(
        '[%s][%d] Failed to re-queue after step lock conflict: %O',
        operationId,
        stepIndex,
        error,
      );
    }
  }

  log(
    '[%s][%d] Step lock conflict — another instance is executing this step, returning locked',
    operationId,
    stepIndex,
  );
  return {
    locked: true,
    nextStepScheduled: false,
    state: {},
    success: false,
  };
}

/**
 * Replay only the completion lifecycle of a parked approval step whose Review
 * publication failed. Returns the step's result when it replayed.
 */
export async function replayPendingInterventionLifecycle(
  deps: StepGuardsDeps,
  {
    agentState,
    externalRetryCount,
    operationId,
    stepIndex,
  }: {
    agentState: AgentState;
    externalRetryCount: number;
    operationId: string;
    stepIndex: number;
  },
): Promise<AgentExecutionResult | undefined> {
  // A parked approval step is already durable before its generic Review
  // is published. When that final Review write fails, the request returns
  // non-2xx and QStash retries this SAME step with `upstash-retried > 0`.
  // The runtime state now has stepCount > stepIndex, so the ordinary stale
  // delivery guard below would ACK it and permanently strand the Review.
  // Replay only the idempotent completion lifecycle: never run beforeStep,
  // runtime.step (LLM/tools), afterStep, or saveStepResult again.
  if (
    agentState.stepCount > stepIndex &&
    deps.shouldReplayPendingInterventionLifecycle(agentState, stepIndex, externalRetryCount)
  ) {
    agentState.metadata = {
      ...agentState.metadata,
      externalRetryCount,
    };

    const reason = 'waiting_for_human' as const;
    const completionSignalEvents = await deps.completionLifecycle.emitSignalEvents(
      operationId,
      agentState,
      reason,
    );
    await deps.completionLifecycle.dispatchHooks(operationId, agentState, reason);
    await deps.recordInterventionLifecycleCompletion(operationId, agentState, stepIndex);
    await deps.traceRecorder.finalize(operationId, {
      appendEventsToLastStep: completionSignalEvents,
      completionReason: reason,
      state: agentState,
    });

    log('[%s][%d] Replayed pending intervention lifecycle', operationId, stepIndex);
    return {
      nextStepScheduled: false,
      state: agentState,
      stepResult: null,
      success: true,
    };
  }

  return undefined;
}

/**
 * A loaded step that must not run: already completed, already terminal,
 * parked for a client, or a shared run whose authorization was revoked.
 * Returns the step's result, or `undefined` when the step runs.
 */
export async function skipUnrunnableStep(
  deps: StepGuardsDeps,
  {
    agentState,
    operationId,
    resumeClientLlm,
    stepIndex,
  }: {
    agentState: AgentState;
    operationId: string;
    resumeClientLlm: AgentExecutionParams['resumeClientLlm'];
    stepIndex: number;
  },
): Promise<AgentExecutionResult | undefined> {
  // Layer 2 defense: catch extremely delayed retries that arrive after lock TTL expired
  if (agentState.stepCount > stepIndex) {
    log(
      '[%s][%d] Step already completed (stepCount=%d), skipping',
      operationId,
      stepIndex,
      agentState.stepCount,
    );
    return {
      nextStepScheduled: false,
      state: agentState,
      stepResult: null,
      success: true,
    };
  }

  // Early exit: skip step if operation is already in a terminal state
  // This prevents executing expensive LLM/tool calls after timeout or interruption
  if (
    agentState.status === 'interrupted' ||
    agentState.status === 'done' ||
    agentState.status === 'error'
  ) {
    log(
      '[%s][%d] Skipping step — operation already in terminal state: %s',
      operationId,
      stepIndex,
      agentState.status,
    );

    return settleSkippedStep(deps, operationId, agentState);
  }

  // A run parked for a client moves only through its own resume: any other
  // delivery (a duplicate, a stale redrive) would replay the call with no
  // client to take it.
  if (agentState.status === 'waiting_for_client' && !resumeClientLlm) {
    log('[%s][%d] Skipping step — operation is waiting for a client', operationId, stepIndex);
    return {
      nextStepScheduled: false,
      state: agentState,
      stepResult: null,
      success: true,
    };
  }

  // Agent Share: re-prove this visitor run's authorization on EVERY step.
  // A revocation only flips the `agent_shares` row — nothing tears down
  // an operation that was already created, so without this the run keeps
  // going under the creator's credentials/budget for the rest of its
  // (potentially very long) lifetime, and the visitor's own Stop button
  // has already stopped working (it re-resolves the now-private share and
  // gets FORBIDDEN). Re-checking here means a revocation cannot survive a
  // step boundary. See `AgentShareModel.isRunStillAuthorized`'s JSDoc for
  // why one query covers every revocation path (visibility flip — which
  // is what turning sharing off does — share delete, agent delete).
  if (
    await isShareRunRevoked(
      deps.delegate.verifyShareRunStillAuthorized,
      operationId,
      stepIndex,
      agentState,
    )
  ) {
    return deps.buildShareAbortResult(operationId, agentState);
  }

  return undefined;
}

/**
 * Settle a step that will not run because the operation is already terminal:
 * emit the completion signals and dispatch the completion hooks so consumers
 * (e.g. the bot local-mode promise) can finalize. Publishes no step event.
 */
export async function settleSkippedStep(
  deps: Pick<StepGuardsDeps, 'completionLifecycle' | 'determineCompletionReason'>,
  operationId: string,
  agentState: AgentState,
): Promise<AgentExecutionResult> {
  const reason = deps.determineCompletionReason(agentState);

  await deps.completionLifecycle.emitSignalEvents(operationId, agentState, reason);
  await deps.completionLifecycle.dispatchHooks(operationId, agentState, reason);

  return {
    nextStepScheduled: false,
    state: agentState,
    stepResult: null,
    success: true,
  };
}
