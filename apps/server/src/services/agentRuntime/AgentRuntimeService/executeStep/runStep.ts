import type { AgentRuntime, AgentRuntimeContext } from '@lobechat/agent-runtime';
import debug from 'debug';

import { formatErrorForState } from '@/server/modules/AgentRuntime/formatErrorForState';

import { isSuccessLikeCompletionReason } from '../../CompletionLifecycle';
import { stepChangedCredentials } from '../../credentialFacts';
import { logToolCallPc } from '../../formalObservation';
import { buildProjectedMessagePatch } from '../../messagePatch';
import { buildStepPresentation, formatTokenCount } from '../../stepPresentation';
import type { AgentRuntimeService } from '..';
import { INTERVENTION_LIFECYCLE_CHECKPOINT_KEY } from '../constants';
import type { InterventionLifecycleCheckpoint } from '../types';
import type { PreparedStepInput } from './prepare';

const log = debug('lobe-server:agent-runtime-service');

export type StepRunResult = Awaited<ReturnType<AgentRuntime['step']>>;
export type StepPresentation = ReturnType<typeof buildStepPresentation>['presentation'];

/**
 * Run the step (or take the forced finish), then reconcile it with a Stop that
 * landed meanwhile, or park the run for a client when no executor could make
 * its LLM call.
 */
export async function runAndReconcileStep(
  svc: AgentRuntimeService,
  {
    currentContext,
    currentState,
    forcedFinishState,
    operationId,
    resumedClientLlmWait,
    runtime,
    stepIndex,
  }: PreparedStepInput & { operationId: string; runtime: AgentRuntime; stepIndex: number },
): Promise<{ startAt: number; stepResult: StepRunResult }> {
  // Execute step (skipped when force-finishing a parked supervisor op).
  const startAt = Date.now();
  logToolCallPc(operationId, stepIndex, 'post.runtime_step_entered', () => ({
    forcedFinish: Boolean(forcedFinishState),
    stateStatus: currentState.status,
  }));
  let stepResult = forcedFinishState
    ? { events: [], newState: forcedFinishState, nextContext: undefined }
    : await runtime.step(currentState, currentContext);

  // Inner runtime.step() catches model-runtime exceptions and stuffs the
  // raw error into newState.error without re-throwing — so the outer
  // catch at the bottom of this method never sees them. Normalize +
  // classify here so the raw error doesn't reach Redis state, the
  // success-path trace finalize, or `persistCompletion`'s JSONB write.
  if (stepResult.newState.error) {
    stepResult.newState.error = formatErrorForState(stepResult.newState.error);
  }
  logToolCallPc(operationId, stepIndex, 'post.runtime_step_returned', () => ({
    errorCategory: stepResult.newState.error?.category ?? null,
    errorRetryable: stepResult.newState.error?.retryable ?? null,
    nextContextPresent: stepResult.nextContext !== undefined,
    stateStatus: stepResult.newState.status,
  }));

  // Check if the operation was interrupted while the step was executing
  // (e.g., user clicked abort during a long LLM call). Prefer the tiny
  // sentinel, but fall back to the state once at the step boundary while
  // old workers that only write `status: 'interrupted'` may still be
  // running during a rolling deployment.
  const sentinelInterrupted = await svc.coordinator.isInterrupted(operationId);
  const wasInterrupted = sentinelInterrupted
    ? true
    : (await svc.coordinator.loadAgentState(operationId))?.status === 'interrupted';
  logToolCallPc(operationId, stepIndex, 'post.latest_state_loaded', () => ({
    interrupted: wasInterrupted,
  }));
  if (wasInterrupted) {
    // Stop can be persisted after a client-tool executor's last local
    // signal check but before this reconciliation read. If that executor
    // just returned a parked state, run the agent's existing abort path
    // once so every pending tool call gets a terminal row before the
    // interrupted state is saved.
    if (
      stepResult.newState.status === 'waiting_for_async_tool' &&
      stepResult.newState.pendingToolsCalling?.length &&
      currentContext
    ) {
      const interruptedState = structuredClone(stepResult.newState);
      interruptedState.status = 'interrupted';
      const abortContext: AgentRuntimeContext = {
        ...currentContext,
        payload: {
          ...(currentContext.payload as Record<string, unknown>),
          hasToolsCalling: true,
          toolsCalling: interruptedState.pendingToolsCalling,
        },
        phase: 'llm_result',
      };
      const abortResult = await runtime.step(interruptedState, abortContext);
      stepResult = {
        ...abortResult,
        events: [...stepResult.events, ...abortResult.events],
      };
    }

    stepResult.newState.status = 'interrupted';
    stepResult.newState.lastModified = new Date().toISOString();
    log('[%s][%d] Operation was interrupted during step execution', operationId, stepIndex);
  } else if (stepResult.newState.status === 'error') {
    // No client could run the step's LLM call: park for one instead of
    // failing (U4c). The parked state is what the step started from, so
    // a resume replays the same call.
    const parkedState = await svc.parkForClientLlm(
      operationId,
      stepResult.newState,
      currentContext,
      resumedClientLlmWait?.expiresAt,
      currentState,
    );
    if (parkedState) {
      stepResult = { ...stepResult, newState: parkedState, nextContext: undefined };
    }
  }

  return { startAt, stepResult };
}

/**
 * Persist the step: file Works and the intervention checkpoint before a
 * terminal save, the gateway message patch, the step result itself, and the
 * `step_complete` event. Returns whether the run continues and the step's
 * presentation.
 */
export async function saveAndPublishStep(
  svc: AgentRuntimeService,
  {
    gatewayMessagePatchEnabled,
    operationId,
    startAt,
    stepIndex,
    stepResult,
    stepStartUiMessages,
  }: {
    gatewayMessagePatchEnabled: boolean;
    operationId: string;
    startAt: number;
    stepIndex: number;
    stepResult: StepRunResult;
    stepStartUiMessages: Awaited<
      ReturnType<AgentRuntimeService['queryStepEntryMessages']>
    >['uiMessages'];
  },
): Promise<{
  content: StepPresentation['content'];
  shouldContinue: boolean;
  stepPresentationData: StepPresentation;
  toolsCalling: StepPresentation['toolsCalling'];
}> {
  // Decide whether to schedule next step (hoisted above the save: it also
  // gates the pre-snapshot file-Work registration below)
  const shouldContinue = svc.shouldContinueExecution(stepResult.newState, stepResult.nextContext);

  // Register entity-file Works BEFORE the terminal save: `saveStepResult`
  // publishes `agent_runtime_end`, whose `uiMessages` snapshot the client
  // adopts as the settled message list — the Work rows must exist by then
  // or the file-Work card stays absent until a manual refresh. Perceived
  // loading is not extended: for runs with entity edits the early
  // `visible_output_end` is suppressed (see `createAgentRuntime`), so
  // loading covers this export window by design. Idempotent — the
  // dispatchHooks backstop below no-ops via the state marker.
  if (!shouldContinue) {
    const preSaveReason = svc.determineCompletionReason(stepResult.newState);
    if (preSaveReason === 'waiting_for_human') {
      stepResult.newState.metadata = {
        ...stepResult.newState.metadata,
        [INTERVENTION_LIFECYCLE_CHECKPOINT_KEY]: {
          state: 'pending',
          stepIndex,
        } satisfies InterventionLifecycleCheckpoint,
      };
    }

    // Success-like reasons ONLY — a `waiting_for_human` park must NOT
    // register because it is not a completed deliverable boundary. The
    // fresh approval continuation sees the complete authoritative
    // history and performs the terminal scan after the decision runs;
    // registering here would freeze pre-approval content too early.
    if (isSuccessLikeCompletionReason(preSaveReason)) {
      await svc.completionLifecycle.registerFileWorks(operationId, stepResult.newState);
      logToolCallPc(operationId, stepIndex, 'post.file_works_registered', () => ({}));
    }
  }

  // Protocol v2 native runs reconcile only what this step changed. The
  // full before/after lists stay server-side; the wire sees a bounded
  // patch. Publish before saveStepResult because a terminal save emits
  // agent_runtime_end immediately, and the client must apply the patch
  // before completing the run.
  if (gatewayMessagePatchEnabled && stepStartUiMessages) {
    const settledUiMessages = await svc.queryUiMessages(stepResult.newState, {
      skipWorks: shouldContinue,
    });
    if (settledUiMessages) {
      // Projected: this branch runs only for a client that asked for
      // protocol 2, which renders tool view models and can fetch a stored
      // payload back. The model-facing lists are read elsewhere, straight
      // off `MessageModel`, and stay whole.
      await svc.streamManager.publishStreamEvent(operationId, {
        data: buildProjectedMessagePatch(stepStartUiMessages, settledUiMessages, stepIndex + 1),
        stepIndex,
        type: 'message_patch',
      });
    }
  }

  // A credential the run just saved or connected changes the list the next
  // step must show, so the snapshot frozen at creation no longer holds.
  // Dropped before the save below — that write is what the next step
  // reloads, and nothing else persists the state on a plain step.
  if (stepChangedCredentials(stepResult.nextContext) && stepResult.newState.operationCredentials) {
    stepResult.newState.operationCredentials = undefined;
    log('[%s][%d] Credentials changed in-run; dropped the snapshot', operationId, stepIndex);
  }

  // Save state, coordinator will handle event sending automatically
  await svc.coordinator.saveStepResult(operationId, {
    ...stepResult,
    executionTime: Date.now() - startAt,
    stepIndex, // placeholder
  });
  logToolCallPc(operationId, stepIndex, 'post.step_result_saved', () => ({
    stateStatus: stepResult.newState.status,
    stateStepCount: stepResult.newState.stepCount,
  }));

  // The next step is scheduled after this event, so it always reports `false`.
  const nextStepScheduled = false;

  // Publish step complete event
  await svc.streamManager.publishStreamEvent(operationId, {
    data: {
      ...(stepResult.newState.host?.includeFinalState === true && {
        finalState: stepResult.newState,
      }),
      nextStepScheduled,
      stepIndex,
    },
    stepIndex,
    type: 'step_complete',
  });
  logToolCallPc(operationId, stepIndex, 'post.step_complete_published', () => ({}));

  await svc.publishSubAgentProgress(stepResult.newState, stepIndex);

  // Build enhanced step completion log & presentation data
  const { presentation: stepPresentationData, summary: stepSummary } = buildStepPresentation(
    stepResult,
    Date.now() - startAt,
  );

  const { usage } = stepResult.newState;
  log(
    '[%s][%d] completed %s | total: %s tokens / $%s | llm×%d | tools×%d',
    operationId,
    stepIndex,
    stepSummary,
    formatTokenCount(stepPresentationData.totalTokens),
    stepPresentationData.totalCost.toFixed(4),
    usage?.llm?.apiCalls ?? 0,
    usage?.tools?.totalCalls ?? 0,
  );

  const toolsCalling = stepPresentationData.toolsCalling;
  const content = stepPresentationData.content;

  return { content, shouldContinue, stepPresentationData, toolsCalling };
}
