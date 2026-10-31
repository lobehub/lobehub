import debug from 'debug';

import { logToolCallPc } from '../../formalObservation';
import { type AgentStepContinuation } from '../../types';
import type { AgentRuntimeServiceContext } from '../types';
import type { StepRunResult } from './runStep';

const log = debug('lobe-server:agent-runtime-service');

/** What this module reads off the service. */
export type StepContinuationDeps = Pick<
  AgentRuntimeServiceContext,
  | 'baseURL'
  | 'calculatePriority'
  | 'calculateStepDelay'
  | 'coordinator'
  | 'queueService'
  | 'streamManager'
  | 'traceRecorder'
>;
/**
 * Hand the next step back to the caller (inline) or queue it. Inlining needs
 * the envelope parked first, so a redelivery can recover the run when this
 * invocation dies mid-step.
 */
export async function scheduleNextStep(
  deps: StepContinuationDeps,
  {
    inlineContinuation,
    operationId,
    stepIndex,
    stepResult,
  }: {
    inlineContinuation: boolean;
    operationId: string;
    stepIndex: number;
    stepResult: StepRunResult;
  },
): Promise<{
  continuation: AgentStepContinuation | undefined;
  handedOffInline: boolean;
  nextStepScheduled: boolean;
}> {
  let continuation: AgentStepContinuation | undefined;
  let handedOffInline = false;
  let nextStepScheduled = false;

  // The caller checks both; repeated here for the type narrowing.
  if (!deps.queueService || !stepResult.nextContext) {
    return { continuation, handedOffInline, nextStepScheduled };
  }

  const nextStepIndex = stepIndex + 1;
  const next: AgentStepContinuation = {
    context: stepResult.nextContext,
    delay: deps.calculateStepDelay(stepResult),
    operationId,
    priority: deps.calculatePriority(stepResult),
    retries:
      typeof stepResult.newState.host?.queue?.retries === 'number'
        ? stepResult.newState.host?.queue?.retries
        : undefined,
    retryDelay:
      typeof stepResult.newState.host?.queue?.retryDelay === 'string'
        ? stepResult.newState.host?.queue?.retryDelay
        : undefined,
    stepIndex: nextStepIndex,
  };

  // Park the envelope before handing it over. The caller is about to run
  // this step in-process with nothing queued behind it; if that
  // invocation dies mid-step, the only way back is for a redelivery to
  // find this envelope — the stale-delivery guard would otherwise ACK
  // the (now older) delivered step and strand the operation.
  //
  // Inlining is therefore conditional on the park succeeding. When it
  // doesn't, fall back to the ordinary queue round-trip: slower by a
  // step boundary, but it keeps the recovery path the queue provides.
  const parked = inlineContinuation
    ? await deps.coordinator.saveInlineResume(operationId, next)
    : false;

  if (!parked && inlineContinuation) {
    log(
      '[%s][%d] Could not park the inline envelope; falling back to the queue',
      operationId,
      stepIndex,
    );
  }

  if (parked) {
    handedOffInline = true;
    // Hand the next step back to the caller instead of paying a full
    // queue round-trip for it. The caller either runs it in this same
    // invocation or publishes it via `scheduleContinuation` when its
    // time budget runs out, so the step is never dropped.
    continuation = next;
    logToolCallPc(operationId, stepIndex, 'post.next_step_inlined', () => ({
      nextStepIndex,
    }));
    log('[%s][%d] Next step %d deferred to caller', operationId, stepIndex, nextStepIndex);
  } else {
    // The next step runs in another invocation, which rebuilds the
    // partial from the store — it has to see this step. The gateway
    // pushes this invocation issued have to land for the same reason:
    // nothing carries them once it stops running.
    await deps.traceRecorder.flushPartial();
    await deps.streamManager.drainPushes?.(operationId);
    await deps.queueService.scheduleMessage({ ...next, endpoint: `${deps.baseURL}/run` });
    nextStepScheduled = true;
    logToolCallPc(operationId, stepIndex, 'post.next_step_scheduled', () => ({
      nextStepIndex,
    }));

    log('[%s][%d] Scheduled next step %d', operationId, stepIndex, nextStepIndex);
  }

  return { continuation, handedOffInline, nextStepScheduled };
}
