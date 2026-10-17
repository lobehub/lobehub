import type { Span } from '@lobechat/observability-otel/api';
import { buildInvokeAgentResultAttributes } from '@lobechat/observability-otel/modules/agent-runtime';
import debug from 'debug';

import { logToolCallPc } from '../../formalObservation';
import type { AgentRuntimeService } from '..';
import type { StepRunResult } from './runStep';

const log = debug('lobe-server:agent-runtime-service');
/**
 * The run stops here: emit the completion signals, dispatch the completion
 * hooks, record a parked intervention, re-check a just-parked async-tool
 * barrier and finalize the trace.
 */
export async function finishOperation(
  svc: AgentRuntimeService,
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
  const reason = svc.determineCompletionReason(stepResult.newState);
  invokeAgentSpan.setAttributes(buildInvokeAgentResultAttributes({ completionReason: reason }));

  // A client park is no completion: the run continues under this id.
  const completionSignalEvents =
    reason === 'waiting_for_client'
      ? []
      : await svc.completionLifecycle.emitSignalEvents(operationId, stepResult.newState, reason);
  logToolCallPc(operationId, stepIndex, 'post.completion_signals', () => ({ reason }));

  // Dispatch completion hooks
  await svc.completionLifecycle.dispatchHooks(operationId, stepResult.newState, reason);
  logToolCallPc(operationId, stepIndex, 'post.completion_hooks', () => ({ reason }));

  if (reason === 'waiting_for_human') {
    await svc.recordInterventionLifecycleCompletion(operationId, stepResult.newState, stepIndex);
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
      await svc.tryResumeParentFromAsyncTool({ parentOperationId: operationId });
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
    await svc.traceRecorder.flushPartial();
  } else
    await svc.traceRecorder.finalize(operationId, {
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
              svc.completionLifecycle.extractErrorMessage(newStateError) ??
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
}
