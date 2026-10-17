import type { Span } from '@lobechat/observability-otel/api';
import { SpanStatusCode } from '@lobechat/observability-otel/api';
import { buildInvokeAgentResultAttributes } from '@lobechat/observability-otel/modules/agent-runtime';
import debug from 'debug';

import { formatErrorForState } from '@/server/modules/AgentRuntime/formatErrorForState';

import { CriticalAgentInterventionPersistenceError } from '../../CompletionLifecycle';
import { logToolCallPc } from '../../formalObservation';
import type { AgentRuntimeService } from '..';

const log = debug('lobe-server:agent-runtime-service');
/**
 * A step threw. Record it on the span, persist the error state, settle the
 * completion lifecycle and finalize the trace, then rethrow — except a failed
 * intervention Review publication, which keeps the run parked for the retry.
 */
export async function failStep(
  svc: AgentRuntimeService,
  {
    error,
    externalRetryCount,
    invokeAgentSpan,
    operationId,
    stepIndex,
    stepStartAt,
  }: {
    error: unknown;
    externalRetryCount: number;
    invokeAgentSpan: Span;
    operationId: string;
    stepIndex: number;
    stepStartAt: number;
  },
): Promise<never> {
  const isInterventionPersistenceFailure =
    error instanceof CriticalAgentInterventionPersistenceError;
  invokeAgentSpan.recordException(error as Error);
  invokeAgentSpan.setStatus({
    code: SpanStatusCode.ERROR,
    message: error instanceof Error ? error.message : String(error),
  });
  invokeAgentSpan.setAttributes(
    buildInvokeAgentResultAttributes({
      completionReason: isInterventionPersistenceFailure ? 'waiting_for_human' : 'error',
    }),
  );

  log('Step %d failed for operation %s: %O', stepIndex, operationId, error);

  // The runtime step and its waiting_for_human state are already durable;
  // only the idempotent generic Review publication failed. Turning this
  // infrastructure failure into an agent error would overwrite the parked
  // state/operation row and make the QStash redelivery terminal-short-circuit.
  // Preserve the parked state and propagate non-2xx so the completed-step
  // lifecycle replay above can retry Review persistence without repeating
  // any LLM or tool side effects.
  if (isInterventionPersistenceFailure) {
    log(
      '[%s][%d] Intervention Review persistence failed; keeping operation parked for retry',
      operationId,
      stepIndex,
    );
    throw error;
  }

  const formattedError = formatErrorForState(error);

  // Build error state — try loading current state from coordinator, but if that
  // also fails (e.g. Redis ECONNRESET), fall back to a minimal error state so
  // that completion callbacks and webhooks can still fire.
  let finalStateWithError: any;
  try {
    await svc.streamManager.publishStreamEvent(operationId, {
      data: {
        error: formattedError.message,
        errorType: String(formattedError.type),
        phase: 'step_execution',
        stepIndex,
      },
      stepIndex,
      type: 'error',
    });
  } catch (publishError) {
    log('[%s] Failed to publish error event (infra may be down): %O', operationId, publishError);
  }

  try {
    const errorState = await svc.coordinator.loadAgentState(operationId);
    finalStateWithError = {
      ...errorState!,
      error: formattedError,
      metadata: {
        ...errorState?.metadata,
        externalRetryCount,
      },
      status: 'error' as const,
      stepCount: errorState?.stepCount ?? stepIndex,
    };
  } catch (loadError) {
    log('[%s] Failed to load error state (infra may be down): %O', operationId, loadError);
    // Fallback: construct a minimal error state so callbacks still receive useful info
    finalStateWithError = {
      error: formattedError,
      metadata: { externalRetryCount },
      status: 'error' as const,
      stepCount: stepIndex,
    };
  }

  try {
    await svc.coordinator.saveAgentState(operationId, finalStateWithError);
  } catch (saveError) {
    log('[%s] Failed to save error state (infra may be down): %O', operationId, saveError);
  }

  await svc.completionLifecycle.emitSignalEvents(operationId, finalStateWithError, 'error');
  logToolCallPc(operationId, stepIndex, 'post.completion_signals', () => ({ reason: 'error' }));

  // Dispatch onComplete + onError hooks
  await svc.completionLifecycle.dispatchHooks(operationId, finalStateWithError, 'error');
  logToolCallPc(operationId, stepIndex, 'post.completion_hooks', () => ({ reason: 'error' }));

  // Finalize the partial snapshot into the canonical S3 path so the
  // failed op is observable in the same place as a successful run.
  // Without this, propagated errors (e.g. markPersistFatal from
  // RuntimeExecutors) leave the partial as an orphan at
  // `_partial/<op>.json.zst` and the canonical
  // `agent-traces/<agentId>/<topicId>/<op>.json.zst` returns 404 — see
  // .
  //
  // `failedStep` synthesizes a step record for the failure because the
  // real step never reached `appendStepToPartial` — it threw before the
  // success path could push it. Without this synthetic step, the
  // snapshot's step count would lag the assistant message that
  // triggered the failing call.
  await svc.traceRecorder.finalize(operationId, {
    completionReason: 'error',
    error: {
      attribution: formattedError.attribution,
      body: formattedError.body,
      category: formattedError.category,
      countAsFailure: formattedError.countAsFailure,
      httpStatus: formattedError.httpStatus,
      message: formattedError.message ?? String(formattedError.type),
      numericId: formattedError.numericId,
      retryable: formattedError.retryable,
      severity: formattedError.severity,
      type: String(formattedError.type),
    },
    failedStep: {
      startedAt: stepStartAt,
      stepIndex,
      stepType: formattedError.category === 'provider' ? 'call_llm' : 'call_tool',
    },
    state: finalStateWithError,
  });
  logToolCallPc(operationId, stepIndex, 'post.trace_finalized', () => ({ reason: 'error' }));

  throw error;
}
