import debug from 'debug';

import type { AgentRuntimeCoordinator } from '@/server/modules/AgentRuntime';
import type {
  AgentExecutionParams,
  AgentExecutionResult,
  AgentStepContinuation,
} from '@/server/services/agentRuntime/types';
import { runWithInvocationDeadline } from '@/server/utils/invocationDeadline';
import {
  flushScheduledWork,
  runWithScheduledWorkScope,
} from '@/server/utils/scheduleAfterResponse';

import type { AiAgentService } from './index';

const log = debug('lobe-server:agent:step-invocation');

/**
 * Longest the loop waits at a step boundary for work the previous step
 * deferred with `after()`.
 *
 * That work includes settling the step's budget hold, which has to finish
 * before the next step reserves again. It normally takes well under a second.
 * The cap only stops one stuck telemetry call from stalling the operation;
 * anything still running keeps going.
 */
export const STEP_BOUNDARY_FLUSH_TIMEOUT_MS = 10_000;

/** What the step loop needs from the service it steps through. */
export type StepInvocationService = Pick<
  AiAgentService,
  'createOperationLockOwner' | 'executeStep' | 'releaseOperationLock' | 'scheduleContinuation'
>;

export interface StepInvocationBudget {
  /**
   * When the host kills this invocation, in epoch ms: the request's start plus
   * the route's `maxDuration`.
   */
  invocationDeadlineAt: number;
  /** Latest point, in epoch ms, at which another step may START in this invocation. */
  stepStartDeadlineAt: number;
}

/** The delivery a step invocation starts from. */
export type StepInvocationDelivery = Omit<
  AgentExecutionParams,
  'inlineContinuation' | 'retainStepLock' | 'stepLockOwner'
>;

export interface StepInvocationResult {
  /** The step the invocation ran last (or was asked to run). */
  currentStepIndex: number;
  /** Steps run after the first one. */
  inlinedSteps: number;
  result: AgentExecutionResult;
}

/**
 * Run a delivered step, then keep stepping inside this invocation for as long
 * as the operation has a next step ready and the budget allows, instead of
 * paying a queue round-trip per step. Whatever is still pending when the budget
 * runs out goes back to the queue.
 *
 * One lock owner spans the whole loop: the operation lock is re-entrant for its
 * owner, so a redelivery from the queue still loses the race the same way it
 * does for a single step. Pass `stepLockOwner` when the caller already claimed
 * the lock with it; the loop releases it either way.
 *
 * Shared by the queue worker (`/api/agent/run`) and the inline step 0 of
 * `execAgent` (`agent_inline_first_step`), so both run steps the same way.
 */
export async function runStepInvocation(
  service: StepInvocationService,
  coordinator: Pick<AgentRuntimeCoordinator, 'clearInlineResume' | 'loadInlineResume'>,
  delivery: StepInvocationDelivery,
  budget: StepInvocationBudget,
  options: { stepLockOwner?: string } = {},
): Promise<StepInvocationResult> {
  const { externalRetryCount, operationId, stepIndex } = delivery;

  const stepLockOwner = options.stepLockOwner ?? service.createOperationLockOwner(operationId);
  let pendingContinuation: AgentStepContinuation | undefined;
  let currentStepIndex = stepIndex;
  let inlinedSteps = 0;
  let result!: AgentExecutionResult;
  // True once this invocation has an envelope to account for: either it
  // resumed from one, or a step handed back a continuation (which parks one).
  let touchedEnvelope = false;

  // Only a plain "run the next step" delivery may be redirected to a parked
  // envelope. Anything carrying its own purpose — an approval, a resume, a
  // watchdog probe — has to run as itself: redirecting it would drop that
  // payload and silently turn it into an ordinary step. The group-member
  // timeout is the sharp edge, because it is always scheduled at stepIndex 0
  // on the member operation, so any envelope at all would swallow it and take
  // the running loop's recovery pointer down with it.
  const isPlainStepDelivery =
    delivery.humanInput === undefined &&
    delivery.approvedToolCall === undefined &&
    delivery.rejectionReason === undefined &&
    delivery.toolMessageId === undefined &&
    !delivery.rejectAndContinue &&
    !delivery.resumeAsyncTool &&
    !delivery.finishAfterAsyncTool &&
    !delivery.verifyAsyncToolBarrier &&
    !delivery.resumeClientLlm &&
    !delivery.clientLlmWaitExpired &&
    !delivery.groupMemberTimeout;

  try {
    // A previous invocation may have died part-way through its own inline loop.
    // It parks the envelope for each step before running it, so an envelope
    // ahead of the delivered index means exactly that: resume from there. Going
    // ahead with the delivered index instead would hit the `stepCount >
    // stepIndex` stale-delivery guard, get ACKed, and strand the operation with
    // nothing queued behind it.
    const parked = isPlainStepDelivery
      ? await coordinator.loadInlineResume<AgentStepContinuation>(operationId)
      : null;
    const resumeFrom = parked && parked.stepIndex > stepIndex ? parked : undefined;
    if (resumeFrom) {
      log(
        `[${operationId}] Delivered step ${stepIndex} is behind a parked inline step ${resumeFrom.stepIndex}; resuming there`,
      );
      currentStepIndex = resumeFrom.stepIndex;
      touchedEnvelope = true;
    }

    // Work a step defers with `after()` (budget settlement, trace flushes,
    // telemetry) normally waits for the HTTP response. One invocation spans
    // many steps, so every earlier step's budget hold would stay reserved until
    // the loop ends and squeeze the next reservation. Scoping it to the loop
    // starts that work immediately and lets each boundary wait for it, which is
    // how it behaved when every step was its own request. Long waits inside a
    // step (a relayed LLM attempt) size themselves to what is left of this
    // invocation.
    await runWithInvocationDeadline(budget.invocationDeadlineAt, () =>
      runWithScheduledWorkScope(async () => {
        // The first iteration carries this delivery's one-shot payload (human
        // input, approvals, resume flags). Later iterations are plain steps, so
        // they must not replay any of it, and neither must a resumed run — it
        // stands in for a later iteration of a dead loop, not for the original
        // message.
        //
        // `externalRetryCount` is the exception, because it describes this
        // delivery rather than the step's payload. A parked approval whose Review
        // failed to persist is only replayed when the count is nonzero, so
        // dropping it here would leave that approval permanently unavailable.
        result = resumeFrom
          ? await service.executeStep({
              context: resumeFrom.context,
              externalRetryCount,
              inlineContinuation: true,
              operationId,
              retainStepLock: true,
              stepIndex: resumeFrom.stepIndex,
              stepLockOwner,
            })
          : await service.executeStep({
              ...delivery,
              inlineContinuation: true,
              retainStepLock: true,
              stepLockOwner,
            });
        pendingContinuation = result.continuation;
        touchedEnvelope ||= Boolean(pendingContinuation);

        while (pendingContinuation) {
          // Let the previous step's deferred work finish first. Its budget
          // hold is released there, and the next step reserves again.
          const settled = await flushScheduledWork({ timeoutMs: STEP_BOUNDARY_FLUSH_TIMEOUT_MS });
          if (!settled) {
            // The deferred work cannot be told apart, so a slow telemetry call
            // and a slow budget settlement look the same. Reserving again on
            // top of an unreleased hold is exactly the false "over budget"
            // this wait exists to prevent, so stop inlining and hand the step
            // to the queue, the way it ran before steps were inlined.
            log(
              `[${operationId}] Deferred work still running after ${STEP_BOUNDARY_FLUSH_TIMEOUT_MS}ms, handing step ${pendingContinuation.stepIndex} back to the queue`,
            );
            break;
          }

          if (Date.now() >= budget.stepStartDeadlineAt) {
            log(
              `[${operationId}] Inline budget spent after ${inlinedSteps} extra step(s), handing step ${pendingContinuation.stepIndex} back to the queue`,
            );
            break;
          }

          const next = pendingContinuation;
          pendingContinuation = undefined;
          currentStepIndex = next.stepIndex;

          result = await service.executeStep({
            context: next.context,
            inlineContinuation: true,
            operationId,
            retainStepLock: true,
            stepIndex: next.stepIndex,
            stepLockOwner,
          });
          inlinedSteps += 1;
          pendingContinuation = result.continuation;
          touchedEnvelope ||= Boolean(pendingContinuation);

          // A lock conflict mid-loop means another worker took over this
          // operation. Stop rather than fight it — that worker owns the rest.
          if (result.locked) break;
        }

        // Whatever is still pending goes back to the queue so the operation
        // resumes in a fresh invocation.
        if (pendingContinuation) {
          await service.scheduleContinuation(pendingContinuation);
          result = { ...result, nextStepScheduled: true };
          pendingContinuation = undefined;
        }

        // Drop the envelope once this invocation is done with it: either the queue
        // owns the next step again, or the operation stopped. Leaving it behind
        // would let a late redelivery re-run a step someone else already owns.
        // Skipped when nothing was ever parked, to keep the flag-off path free of
        // an extra Redis round-trip.
        //
        // Scoped to our lock owner, because "done with it" is only true while we
        // still hold the operation. A delivery that read an envelope and then lost
        // the lock race must not delete the newer one the live worker parked.
        if (touchedEnvelope) {
          await coordinator.clearInlineResume(operationId, stepLockOwner);
        }
      }),
    );
  } finally {
    // Owner-scoped, so this is a no-op when the first step never claimed the
    // lock (a conflicting delivery, a terminal operation, a watchdog probe).
    await service.releaseOperationLock(operationId, stepLockOwner);
  }

  return { currentStepIndex, inlinedSteps, result };
}
