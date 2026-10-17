import { context as otelContext, trace as otelTrace } from '@lobechat/observability-otel/api';
import {
  buildInvokeAgentAttributes,
  buildInvokeAgentResultAttributes,
  invokeAgentSpanName,
  tracer as agentRuntimeTracer,
} from '@lobechat/observability-otel/modules/agent-runtime';
import debug from 'debug';

import {
  type AgentExecutionParams,
  type AgentExecutionResult,
  type AgentStepContinuation,
} from '../../types';
import type { AgentRuntimeService } from '..';
import { STEP_LOCK_TTL_SECONDS } from '../constants';
import { createStepLockOwner } from '../utils';
import { startStepAbortPoll, type StepAbortPoll } from './abortPoll';
import { finishOperation } from './completion';
import { scheduleNextStep } from './continuation';
import { failStep } from './failure';
import {
  handleStepLockConflict,
  replayPendingInterventionLifecycle,
  runLockFreeDelivery,
  skipUnrunnableStep,
} from './guards';
import { dispatchAfterStepHooks, dispatchBeforeStepHooks, persistStepTracking } from './hooks';
import { prepareStepInput } from './prepare';
import { runAndReconcileStep, saveAndPublishStep } from './runStep';

const log = debug('lobe-server:agent-runtime-service');

/**
 * Execute Agent step
 */
export async function executeStep(
  svc: AgentRuntimeService,
  params: AgentExecutionParams,
): Promise<AgentExecutionResult> {
  const {
    operationId,
    stepIndex,
    resumeClientLlm,
    externalRetryCount = 0,
    inlineContinuation = false,
    retainStepLock = false,
    stepLockOwner: providedStepLockOwner,
  } = params;

  const lockFree = await runLockFreeDelivery(svc, params);
  if (lockFree) return lockFree;

  // ===== Distributed lock: prevent duplicate execution from QStash retries =====
  const stepLockOwner = providedStepLockOwner ?? createStepLockOwner(operationId, stepIndex);
  const claimed = await svc.coordinator.tryClaimStep(
    operationId,
    stepIndex,
    STEP_LOCK_TTL_SECONDS,
    stepLockOwner,
  );
  if (!claimed) return handleStepLockConflict(svc, params);

  await svc.agentOperationModel.touchRunning(operationId).catch((error) => {
    log('[%s][%d] Operation lease refresh failed: %O', operationId, stepIndex, error);
  });
  const stopStepLockHeartbeat = svc.startStepLockHeartbeat(operationId, stepIndex, stepLockOwner);

  // Hoisted so the shared `finally` can stop it on every exit path — an
  // orphaned poll would keep reading Redis for a step that is long gone.
  let abortPoll: StepAbortPoll | undefined;

  // Hoisted so the error-path snapshot finalize can record an
  // approximate startedAt for the failing step. The inner `startAt` at the
  // runtime.step() call site stays as the authoritative start for the
  // success path.
  const stepStartAt = Date.now();

  // Hoisted so the shared `finally` knows whether the next step stays in this
  // invocation. When it does, the accumulated trace partial stays in memory;
  // on every other exit some other process reads it, so it has to be durable.
  let handedOffInline = false;

  // OTel invoke_agent span. Wraps the entire step body so child spans
  // (chat / execute_tool / context_engineering) auto-nest via the active
  // context. Started with minimal attrs; agent/model/topic are added once
  // agentState is loaded.
  const invokeAgentSpan = agentRuntimeTracer.startSpan(invokeAgentSpanName(), {
    attributes: buildInvokeAgentAttributes({ operationId, stepIndex }),
  });
  const invokeAgentCtx = otelTrace.setSpan(otelContext.active(), invokeAgentSpan);

  try {
    return await otelContext.with(invokeAgentCtx, async () => {
      log('[%s][%d] Start step executing...', operationId, stepIndex);

      // Load agent state BEFORE publishing step_start so we can attach the
      // canonical UIChatMessage snapshot to the event payload. step_start
      // fires after the previous step's DB writes are awaited durable, so
      // the snapshot query here reflects strongly-consistent state — that's
      // the contract that lets the client treat the pushed uiMessages as
      // the source of truth instead of doing its own refetch.
      const agentState = await svc.coordinator.loadAgentState(operationId);

      if (!agentState) {
        throw new Error(`Agent state not found for operation ${operationId}`);
      }

      const replayed = await replayPendingInterventionLifecycle(svc, {
        agentState,
        externalRetryCount,
        operationId,
        stepIndex,
      });
      if (replayed) return replayed;

      const gatewayMessagePatchEnabled = svc.usesGatewayMessagePatch(agentState);
      const { uiMessages: stepStartUiMessages, messages: stepEntryMessages } =
        await svc.queryStepEntryMessages(agentState);
      await svc.streamManager.publishStreamEvent(operationId, {
        data: gatewayMessagePatchEnabled
          ? { messageRevision: stepIndex }
          : { ...(stepStartUiMessages !== undefined && { uiMessages: stepStartUiMessages }) },
        stepIndex,
        type: 'step_start',
      });

      agentState.metadata = {
        ...agentState.metadata,
        externalRetryCount,
      };

      // Enrich invoke_agent span with agent identity now that state is loaded.
      const stateAgentConfig = agentState.world?.agent as
        { description?: string | null; title?: string | null } | undefined;
      const stateModel = agentState.modelRuntimeConfig?.model;
      const stateProvider = agentState.modelRuntimeConfig?.provider;
      invokeAgentSpan.updateName(invokeAgentSpanName(stateAgentConfig?.title ?? undefined));
      invokeAgentSpan.setAttributes(
        buildInvokeAgentAttributes({
          agentDescription: stateAgentConfig?.description ?? undefined,
          agentId: agentState.origin?.agentId,
          agentName: stateAgentConfig?.title ?? undefined,
          conversationId: agentState.origin?.topicId,
          operationId,
          provider: stateProvider,
          requestModel: stateModel,
          stepIndex,
        }),
      );

      const skipped = await skipUnrunnableStep(svc, {
        agentState,
        operationId,
        resumeClientLlm,
        stepIndex,
      });
      if (skipped) return skipped;

      const beforeStepSignalEvents = await dispatchBeforeStepHooks(svc, {
        agentState,
        operationId,
        stepIndex,
      });

      // Per-step buffer for context engine input/output. Populated by the
      // `tracingContextEngine` callback passed into the executor context;
      // consumed by traceRecorder.appendStep below. Routing CE this way keeps
      // its heavy payload (agentDocuments, systemRole, …) out of
      // `stepResult.events` and therefore out of the Redis state pipeline.
      //
      // Context: contextEngine.input (agentDocuments) was ~2.7MB/step,
      // hitting Upstash Redis 10MB limit. Bypassing events keeps the heavy
      // payload in trace only, reducing per-step Redis state by ~500x.
      let contextEnginePayload: { input: unknown; metadata?: unknown; output: unknown } | undefined;

      // Create Agent and Runtime instances
      // Use agentState.metadata which contains the full app context (topicId, agentId, etc.)
      // operationMetadata only contains basic fields (agentConfig, modelRuntimeConfig, userId)
      abortPoll = startStepAbortPoll(svc, operationId, stepIndex);

      const { runtime } = await svc.createAgentRuntime({
        abortSignal: abortPoll.signal,
        agentState,
        operationId,
        stepIndex,
        tracingContextEngine: (input, output, metadata) => {
          contextEnginePayload = { input, metadata, output };
        },
      });

      const input = await prepareStepInput(svc, { agentState, params, stepEntryMessages });
      const { currentContext } = input;

      const { startAt, stepResult } = await runAndReconcileStep(svc, {
        ...input,
        operationId,
        runtime,
        stepIndex,
      });

      const { content, shouldContinue, stepPresentationData, toolsCalling } =
        await saveAndPublishStep(svc, {
          gatewayMessagePatchEnabled,
          operationId,
          startAt,
          stepIndex,
          stepResult,
          stepStartUiMessages,
        });

      const afterStepSignalEvents = await dispatchAfterStepHooks(svc, {
        content,
        operationId,
        shouldContinue,
        stepIndex,
        stepPresentationData,
        stepResult,
        toolsCalling,
      });

      await svc.traceRecorder.appendStep(operationId, {
        afterStepSignalEvents,
        agentState,
        beforeStepSignalEvents,
        contextEngine: contextEnginePayload,
        currentContext,
        externalRetryCount,
        presentation: stepPresentationData,
        startedAt: startAt,
        stepIndex,
        stepResult,
      });

      await persistStepTracking(svc, {
        content,
        operationId,
        shouldContinue,
        stepIndex,
        stepResult,
        toolsCalling,
      });

      let nextStepScheduled = false;
      let continuation: AgentStepContinuation | undefined;
      if (shouldContinue && stepResult.nextContext && svc.queueService) {
        const scheduled = await scheduleNextStep(svc, {
          inlineContinuation,
          operationId,
          stepIndex,
          stepResult,
        });
        continuation = scheduled.continuation;
        nextStepScheduled = scheduled.nextStepScheduled;
        if (scheduled.handedOffInline) handedOffInline = true;
      }

      // Record final agent-level usage on the invoke_agent span. Done on every
      // step so partial trees (e.g. interrupted runs) still carry the
      // last-known token counters.
      invokeAgentSpan.setAttributes(
        buildInvokeAgentResultAttributes({
          inputTokens: stepResult.newState.usage?.llm?.tokens?.input,
          outputTokens: stepResult.newState.usage?.llm?.tokens?.output,
          stepCount: stepResult.newState.stepCount,
        }),
      );

      if (!shouldContinue) {
        await finishOperation(svc, { invokeAgentSpan, operationId, stepIndex, stepResult });
      }

      return {
        continuation,
        nextStepScheduled,
        state: stepResult.newState,
        stepResult,
        success: true,
      };
    });
  } catch (error) {
    return await failStep(svc, {
      error,
      externalRetryCount,
      invokeAgentSpan,
      operationId,
      stepIndex,
      stepStartAt,
    });
  } finally {
    invokeAgentSpan.end();
    abortPoll?.stop();
    stopStepLockHeartbeat();
    // Parked runs (human input, async tools) and finished ones are read back
    // by a different invocation, so the partial cannot stay in memory only.
    // An inline hand-off keeps it: the next step runs on this recorder.
    if (!handedOffInline) {
      await svc.traceRecorder.flushPartial();
      // Same boundary for the stream: an issued push is only guaranteed to
      // reach the gateway while this invocation is still running.
      await svc.streamManager.drainPushes?.(operationId);
    }
    // The inline step loop keeps the lock across step boundaries — releasing
    // here would open a window for a stale redelivery to claim it mid-run.
    // Its caller releases once, in a `finally`, for the whole invocation.
    if (!retainStepLock) {
      await svc.coordinator.releaseStepLock(operationId, stepIndex, stepLockOwner);
    }
  }
}
