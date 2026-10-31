import type { Span } from '@lobechat/observability-otel/api';
import { buildInvokeAgentResultAttributes } from '@lobechat/observability-otel/modules/agent-runtime';
import debug from 'debug';

import { logToolCallPc } from '../../formalObservation';
import { steerQueueScopeOf } from '../../steerQueueScope';
import type { AgentRuntimeServiceContext } from '../types';
import type { StepRunResult } from './runStep';

const log = debug('lobe-server:agent-runtime-service');

/** What this module reads off the service. */
export type StepCompletionDeps = Pick<
  AgentRuntimeServiceContext,
  | 'completionLifecycle'
  | 'delegate'
  | 'determineCompletionReason'
  | 'recordInterventionLifecycleCompletion'
  | 'traceRecorder'
  | 'tryResumeParentFromAsyncTool'
  | 'userId'
>;
/**
 * The run stops here: emit the completion signals, dispatch the completion
 * hooks, record a parked intervention, re-check a just-parked async-tool
 * barrier, finalize the trace and start the follow-ups queued behind it.
 */
export async function finishOperation(
  deps: StepCompletionDeps,
  {
    invokeAgentSpan,
    operationId,
    stepIndex,
    stepResult,
  }: {
    invokeAgentSpan: Span;
    operationId: string;
    stepIndex: number;
    stepResult: StepRunResult;
  },
): Promise<void> {
  const reason = deps.determineCompletionReason(stepResult.newState);
  invokeAgentSpan.setAttributes(buildInvokeAgentResultAttributes({ completionReason: reason }));

  // A client park is no completion: the run continues under this id.
  const completionSignalEvents =
    reason === 'waiting_for_client'
      ? []
      : await deps.completionLifecycle.emitSignalEvents(operationId, stepResult.newState, reason);
  logToolCallPc(operationId, stepIndex, 'post.completion_signals', () => ({ reason }));

  // Dispatch completion hooks
  await deps.completionLifecycle.dispatchHooks(operationId, stepResult.newState, reason);
  logToolCallPc(operationId, stepIndex, 'post.completion_hooks', () => ({ reason }));

  if (reason === 'waiting_for_human') {
    await deps.recordInterventionLifecycleCompletion(operationId, stepResult.newState, stepIndex);
  }

  // Park-time self-check: sub-agents are dispatched mid-step, so a
  // fast child can complete BEFORE this op's parked state/row were
  // persisted — its resume attempt then no-ops against the status
  // guard and nothing retries. Now that both the Redis state and the
  // `agent_operations` row (via dispatchHooks → persistCompletion)
  // say `waiting_for_async_tool`, re-run the barrier once to recover
  // any resume that raced the park.
  if (stepResult.newState.status === 'waiting_for_async_tool') {
    try {
      await deps.tryResumeParentFromAsyncTool({ parentOperationId: operationId });
    } catch (selfCheckError) {
      log(
        '[%s][%d] Park-time async-tool self-check failed (non-fatal): %O',
        operationId,
        stepIndex,
        selfCheckError,
      );
    }
  }

  // Finalize tracing snapshot. The error catch below uses the same
  // recorder so propagated failures still write the canonical S3
  // snapshot instead of orphaning the partial ().
  // A client park is no trace boundary: keep the partial so the resumed
  // steps extend the same trajectory and the real end finalizes it whole.
  const newStateError = stepResult.newState.error;
  if (reason === 'waiting_for_client') {
    await deps.traceRecorder.flushPartial();
  } else
    await deps.traceRecorder.finalize(operationId, {
      appendEventsToLastStep: completionSignalEvents,
      completionReason: reason,
      error: newStateError
        ? {
            attribution: newStateError.attribution,
            body: newStateError.body,
            category: newStateError.category,
            countAsFailure: newStateError.countAsFailure,
            httpStatus: newStateError.httpStatus,
            message:
              deps.completionLifecycle.extractErrorMessage(newStateError) ??
              JSON.stringify(newStateError),
            numericId: newStateError.numericId,
            retryable: newStateError.retryable,
            severity: newStateError.severity,
            type: String(newStateError.type ?? newStateError.errorType ?? 'unknown'),
          }
        : undefined,
      state: stepResult.newState,
    });
  logToolCallPc(operationId, stepIndex, 'post.trace_finalized', () => ({ reason }));

  // Follow-ups the user queued behind this run start as the next turn right
  // here, instead of after the client hears the run ended and sends them
  // itself. Only after the hooks above: they persist the terminal row and
  // release the topic, which the next turn has to claim. A parked run keeps
  // its queue until it really ends; a failed or stopped one leaves it to the
  // user.
  const steerScope = steerQueueScopeOf(stepResult.newState, deps.userId);
  if (stepResult.newState.status === 'done' && steerScope && deps.delegate.startQueuedFollowUp) {
    try {
      await deps.delegate.startQueuedFollowUp({ operationId, scope: steerScope });
    } catch (error) {
      log(
        '[%s][%d] Starting queued follow-ups failed (non-fatal): %O',
        operationId,
        stepIndex,
        error,
      );
    }
  }
}
