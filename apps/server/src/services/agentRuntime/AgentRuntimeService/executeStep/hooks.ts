import type { AgentState } from '@lobechat/agent-runtime';
import debug from 'debug';

import { emitAgentSignalSourceEvent } from '@/server/services/agentSignal';

import { isAgentShareRun } from '../../CompletionLifecycle';
import { logToolCallPc } from '../../formalObservation';
import { hookDispatcher } from '../../hooks';
import type { AgentRuntimeService } from '..';
import { toAgentSignalSnapshotEvents } from '../utils';
import type { StepPresentation, StepRunResult } from './runStep';

const log = debug('lobe-server:agent-runtime-service');
type SignalSnapshotEvents = Array<{ [key: string]: unknown; type: string }>;

/** Emit the `runtime.before_step` signal and dispatch the `beforeStep` hooks. */
export async function dispatchBeforeStepHooks(
  svc: AgentRuntimeService,
  {
    agentState,
    operationId,
    stepIndex,
  }: { agentState: AgentState; operationId: string; stepIndex: number },
): Promise<SignalSnapshotEvents> {
  let beforeStepSignalEvents: Array<{ [key: string]: unknown; type: string }> = [];

  // Dispatch beforeStep hooks
  try {
    const beforeStepOrigin = agentState?.origin ?? {};
    // Agent Share visitor runs execute AS the creator, so this
    // `userId`-scoped source event would record creator-owned Agent
    // Signal state for a turn an anonymous link visitor triggered — same
    // reasoning (and same predicate) as the completion-signal guard in
    // `CompletionLifecycle.emitSignalEvents`.
    const beforeStepSignalEmission = isAgentShareRun(agentState)
      ? undefined
      : await emitAgentSignalSourceEvent(
          {
            payload: {
              agentId: beforeStepOrigin.agentId,
              operationId,
              serializedContext: undefined,
              stepIndex,
              topicId: beforeStepOrigin.topicId,
              turnCount: agentState?.stepCount || 0,
            },
            sourceId: `${operationId}:before:${stepIndex}`,
            sourceType: 'runtime.before_step',
          },
          {
            agentId: beforeStepOrigin.agentId,
            db: svc.serverDB,
            userId: beforeStepOrigin.userId || svc.userId,
            workspaceId: svc.workspaceId,
          },
          { ignoreError: true },
        );
    beforeStepSignalEvents = toAgentSignalSnapshotEvents(beforeStepSignalEmission);
    await hookDispatcher.dispatch(
      operationId,
      'beforeStep',
      {
        agentId: beforeStepOrigin.agentId || '',
        finalState: agentState,
        operationId,
        stepIndex,
        steps: agentState?.stepCount || 0,
        userId: beforeStepOrigin.userId || svc.userId,
      },
      agentState?.host?.hooks,
    );
  } catch (hookError) {
    log('[%s] beforeStep hook dispatch error: %O', operationId, hookError);
  }

  return beforeStepSignalEvents;
}

/**
 * Emit the `runtime.after_step` signal and dispatch the `afterStep` hooks,
 * enriched with the step's presentation and the cross-step tracking data.
 */
export async function dispatchAfterStepHooks(
  svc: AgentRuntimeService,
  {
    content,
    operationId,
    shouldContinue,
    stepIndex,
    stepPresentationData,
    stepResult,
    toolsCalling,
  }: {
    content: StepPresentation['content'];
    operationId: string;
    shouldContinue: boolean;
    stepIndex: number;
    stepPresentationData: StepPresentation;
    stepResult: StepRunResult;
    toolsCalling: StepPresentation['toolsCalling'];
  },
): Promise<SignalSnapshotEvents> {
  let afterStepSignalEvents: Array<{ [key: string]: unknown; type: string }> = [];

  // Dispatch afterStep hooks (enriched with step presentation + tracking data)
  try {
    const metadata = stepResult.newState?.metadata || {};
    const origin = stepResult.newState?.origin ?? {};
    const tracking = metadata._stepTracking || {};
    const elapsedMs = stepResult.newState?.createdAt
      ? Date.now() - new Date(stepResult.newState.createdAt).getTime()
      : undefined;
    const stepLabel = metadata?._stepLabel;

    // See the `runtime.before_step` guard above — same share-visitor
    // suppression at the sibling per-step emission.
    afterStepSignalEvents = toAgentSignalSnapshotEvents(
      isAgentShareRun(stepResult.newState)
        ? undefined
        : await emitAgentSignalSourceEvent(
            {
              payload: {
                agentId: origin.agentId,
                operationId,
                serializedContext: undefined,
                stepIndex,
                topicId: origin.topicId,
                turnCount: stepResult.newState?.stepCount || 0,
              },
              sourceId: `${operationId}:after:${stepIndex}`,
              sourceType: 'runtime.after_step',
            },
            {
              agentId: origin.agentId,
              db: svc.serverDB,
              userId: origin.userId || svc.userId,
            },
            { ignoreError: true },
          ),
    );

    await hookDispatcher.dispatch(
      operationId,
      'afterStep',
      {
        agentId: origin.agentId || '',
        content,
        elapsedMs,
        executionTimeMs: stepPresentationData.executionTimeMs,
        finalState: stepResult.newState,
        ...(stepLabel && { stepLabel }),
        lastLLMContent: tracking.lastLLMContent,
        lastToolsCalling: tracking.lastToolsCalling,
        operationId,
        reasoning: stepPresentationData.reasoning,
        shouldContinue,
        status: stepResult.newState?.status,
        stepCost: stepPresentationData.stepCost,
        stepIndex,
        stepType: stepPresentationData.stepType,
        steps: stepResult.newState?.stepCount || 0,
        thinking: stepPresentationData.thinking,
        toolCalls: stepResult.newState?.usage?.tools?.totalCalls,
        toolsCalling: stepPresentationData.toolsCalling,
        toolsResult: stepPresentationData.toolsResult,
        topicId: origin.topicId,
        totalCost: stepPresentationData.totalCost,
        totalInputTokens: stepPresentationData.totalInputTokens,
        totalOutputTokens: stepPresentationData.totalOutputTokens,
        totalSteps: stepPresentationData.totalSteps,
        totalTokens: stepPresentationData.totalTokens,
        totalToolCalls: (tracking.totalToolCalls ?? 0) + (toolsCalling?.length ?? 0),
        userId: origin.userId || svc.userId,
      },
      stepResult.newState?.host?.hooks,
    );
  } catch (hookError) {
    log('[%s] afterStep hook dispatch error: %O', operationId, hookError);
  }

  return afterStepSignalEvents;
}

/** Accumulate the step tracking the next step's `afterStep` hooks read. */
export async function persistStepTracking(
  svc: AgentRuntimeService,
  {
    content,
    operationId,
    shouldContinue,
    stepIndex,
    stepResult,
    toolsCalling,
  }: {
    content: StepPresentation['content'];
    operationId: string;
    shouldContinue: boolean;
    stepIndex: number;
    stepResult: StepRunResult;
    toolsCalling: StepPresentation['toolsCalling'];
  },
): Promise<void> {
  // Update step tracking in state metadata for afterStep hooks (cross-step accumulator)
  const hasAfterStepHooks = stepResult.newState.host?.hooks?.some(
    (h: { type: string }) => h.type === 'afterStep',
  );
  logToolCallPc(operationId, stepIndex, 'post.trace_appended', () => ({}));
  logToolCallPc(operationId, stepIndex, 'post.route_selected', () => ({
    hasAfterStepHooks,
    nextContextPresent: stepResult.nextContext !== undefined,
    queueAvailable: Boolean(svc.queueService),
    shouldContinue,
  }));
  if (hasAfterStepHooks && stepResult.newState.metadata) {
    const prevTracking = stepResult.newState.metadata._stepTracking || {};
    const newTotalToolCalls = (prevTracking.totalToolCalls ?? 0) + (toolsCalling?.length ?? 0);

    // Truncate content to 1800 chars to keep state small
    const truncatedContent = content
      ? content.length > 1800
        ? content.slice(0, 1800) + '...'
        : content
      : prevTracking.lastLLMContent;

    const updatedTracking = {
      lastLLMContent: truncatedContent,
      lastToolsCalling: toolsCalling || prevTracking.lastToolsCalling,
      totalToolCalls: newTotalToolCalls,
    };

    // Persist tracking state for next step
    stepResult.newState.metadata._stepTracking = updatedTracking;
    await svc.coordinator.saveAgentState(operationId, stepResult.newState);
    logToolCallPc(operationId, stepIndex, 'post.step_tracking_saved', () => ({}));
  }
}
