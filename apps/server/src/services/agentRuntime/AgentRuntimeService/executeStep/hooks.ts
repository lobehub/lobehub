import type { AgentState } from '@lobechat/agent-runtime';
import { getLlmCallCount } from '@lobechat/agent-runtime';
import debug from 'debug';

import { emitAgentSignalSourceEvent } from '@/server/services/agentSignal';

import { isAgentShareRun } from '../../CompletionLifecycle';
import { logToolCallPc } from '../../formalObservation';
import { hookDispatcher } from '../../hooks';
import type { AgentRuntimeServiceContext } from '../types';
import { toAgentSignalSnapshotEvents } from '../utils';
import type { StepPresentation, StepRunResult } from './runStep';

const log = debug('lobe-server:agent-runtime-service');

/** What this module reads off the service. */
export type StepHooksDeps = Pick<
  AgentRuntimeServiceContext,
  'coordinator' | 'queueService' | 'serverDB' | 'userId' | 'workspaceId'
>;
type SignalSnapshotEvents = Array<{ [key: string]: unknown; type: string }>;

/** Emit the `runtime.before_step` signal and dispatch the `beforeStep` hooks. */
export async function dispatchBeforeStepHooks(
  deps: StepHooksDeps,
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
              turnCount: getLlmCallCount(agentState),
            },
            sourceId: `${operationId}:before:${stepIndex}`,
            sourceType: 'runtime.before_step',
          },
          {
            agentId: beforeStepOrigin.agentId,
            db: deps.serverDB,
            userId: beforeStepOrigin.userId || deps.userId,
            workspaceId: deps.workspaceId,
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
        steps: getLlmCallCount(agentState),
        userId: beforeStepOrigin.userId || deps.userId,
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
  deps: StepHooksDeps,
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
                turnCount: getLlmCallCount(stepResult.newState),
              },
              sourceId: `${operationId}:after:${stepIndex}`,
              sourceType: 'runtime.after_step',
            },
            {
              agentId: origin.agentId,
              db: deps.serverDB,
              userId: origin.userId || deps.userId,
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
        steps: getLlmCallCount(stepResult.newState),
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
        userId: origin.userId || deps.userId,
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
  deps: StepHooksDeps,
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
    queueAvailable: Boolean(deps.queueService),
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
    await deps.coordinator.saveAgentState(operationId, stepResult.newState);
    logToolCallPc(operationId, stepIndex, 'post.step_tracking_saved', () => ({}));
  }
}
