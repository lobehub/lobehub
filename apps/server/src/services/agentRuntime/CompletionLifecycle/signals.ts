/**
 * Completion Agent Signal source events.
 */
import { getLlmCallCount } from '@lobechat/agent-runtime';
import { isRecord } from '@lobechat/utils/object';
import debug from 'debug';

import { emitAgentSignalSourceEvent } from '@/server/services/agentSignal';
import { toAgentSignalTraceEvents } from '@/server/services/agentSignal/observability/traceEvents';
import { parseAgentSignalMarker } from '@/server/services/agentSignal/operationMarker';
import { extractSelfIterationCompletionPayload } from '@/server/services/agentSignal/services/selfIteration/completion';

import { buildLifecycleEvent, extractErrorMessage } from './lifecycleEvent';
import type { CompletionLifecycleDeps, SignalEvent } from './types';

const log = debug('lobe-server:completion-lifecycle');

/**
 * Whether a lifecycle event's `metadata` belongs to an Agent Share visitor
 * run. `principal.actor.shareVisitor.visitorUserId` is stamped once at operation
 * creation (`AgentRuntimeService.createOperation`'s `initialState.metadata`)
 * and rides the state through to the terminal event — mirrors
 * `GatewayStreamNotifier`'s share-visitor check, the sibling chokepoint that
 * scrubs the creator's `AgentState` off the visitor's WS channel.
 *
 * Exported so every OTHER chokepoint that emits a `userId`-scoped Agent
 * Signal source event on the runtime's `state`/operation metadata (the
 * `runtime.before_step` / `runtime.after_step` emissions in
 * `AgentRuntimeService`) can reuse the exact same check instead of
 * hand-rolling their own.
 */
export const isAgentShareRun = (
  state:
    { principal?: { actor?: { shareVisitor?: { visitorUserId?: string } } } } | undefined | null,
): boolean => Boolean(state?.principal?.actor?.shareVisitor?.visitorUserId);

const toAgentSignalSnapshotEvents = (
  emission: Awaited<ReturnType<typeof emitAgentSignalSourceEvent>> | undefined,
): SignalEvent[] => {
  if (!emission || emission.deduped) return [];
  return toAgentSignalTraceEvents({
    actions: emission.orchestration.actions,
    results: emission.orchestration.results,
    signals: emission.orchestration.emittedSignals,
    source: emission.source,
  });
};

/**
 * Emit completion AgentSignal source events and return compact snapshot
 * events for attachment to the trace step. Fire-and-forget.
 */
export async function emitSignalEvents(
  deps: CompletionLifecycleDeps,
  operationId: string,
  state: any,
  reason: string,
): Promise<SignalEvent[]> {
  try {
    const {
      assistantMessageId,
      metadata,
      origin: runOrigin,
    } = buildLifecycleEvent(deps.userId, operationId, state, reason);

    // Agent Share visitor runs execute AS the creator (`runOrigin.userId` is
    // the creator's id — see `isAgentShareRun`'s JSDoc), so every completion
    // signal below (`agent.execution.completed` / `.failed`) would otherwise
    // run synchronous policy processing and record creator-scoped windows /
    // telemetry for a run an anonymous link visitor triggered. Suppress the
    // whole emission rather than merely re-scoping it: a share visitor has no
    // Agent Signal identity of its own to attribute this to.
    if (isAgentShareRun(state)) {
      log(
        '[completion-lifecycle] skip agent signal emission for share visitor run op=%s reason=%s',
        operationId,
        reason,
      );
      return [];
    }

    let selfIteration =
      reason === 'error' ? undefined : extractSelfIterationCompletionPayload(state);
    if (reason !== 'error' && !selfIteration) {
      try {
        const operation = await deps.agentOperationModel.findById(operationId);
        const operationMetadata = operation?.metadata;
        if (operationMetadata?.agentSignal) {
          selfIteration = extractSelfIterationCompletionPayload({
            ...state,
            origin: {
              ...runOrigin,
              signal: parseAgentSignalMarker(operationMetadata.agentSignal),
              userId: runOrigin.userId || deps.userId,
            },
          });
        }
      } catch (error) {
        log(
          '[completion-lifecycle] failed to hydrate Agent Signal marker op=%s: %O',
          operationId,
          error,
        );
      }
    }
    // A memory-writer run's terminal state may not carry the tool calls that
    // name the written memory (messages live in the DB). When the receipt would
    // fall back to a generic "Memory saved" with no id, re-read the run's own
    // thread so it can name the memory and offer undo.
    const memoryTargetUnresolved = selfIteration?.mutations.some((mutation) => {
      const target = isRecord(mutation.data) ? mutation.data.target : undefined;
      return !isRecord(target) || !target.id;
    });
    if (selfIteration?.marker.kind === 'memory' && memoryTargetUnresolved && runOrigin.threadId) {
      try {
        const messages = await deps.messageModel.query(
          {
            agentId: runOrigin.agentId,
            threadId: runOrigin.threadId,
            topicId: runOrigin.topicId,
          },
          { allowShareVisitor: true },
        );
        selfIteration =
          extractSelfIterationCompletionPayload({
            ...state,
            messages,
            origin: { ...runOrigin, signal: selfIteration.marker, userId: selfIteration.userId },
          }) ?? selfIteration;
      } catch (error) {
        log(
          '[completion-lifecycle] failed to load memory-writer messages op=%s: %O',
          operationId,
          error,
        );
      }
    }
    if (reason !== 'error') {
      log(
        '[completion-lifecycle] emit agent.execution.completed op=%s userId=%s assistant=%s metaAssistant=%s selfIteration=%s',
        operationId,
        runOrigin.userId || deps.userId,
        assistantMessageId ?? 'undefined',
        metadata?.assistantMessageId ?? 'undefined',
        selfIteration
          ? `kind=${selfIteration.marker?.kind} mutations=${selfIteration.mutations?.length}`
          : 'ABSENT',
      );
    }
    const completionSignalEmission =
      reason === 'error'
        ? await emitAgentSignalSourceEvent(
            {
              payload: {
                agentId: runOrigin.agentId,
                errorMessage: extractErrorMessage(state?.error),
                operationId,
                reason,
                serializedContext: undefined,
                topicId: runOrigin.topicId,
                turnCount: getLlmCallCount(state),
              },
              sourceId: `${operationId}:complete:${reason}`,
              sourceType: 'agent.execution.failed',
            },
            {
              agentId: runOrigin.agentId,
              db: deps.serverDB,
              userId: runOrigin.userId || deps.userId,
              workspaceId: deps.workspaceId,
            },
            { ignoreError: true },
          )
        : await emitAgentSignalSourceEvent(
            {
              payload: {
                agentId: runOrigin.agentId,
                // Anchor the deferred skill synthesis to the completed assistant
                // turn: the completion-stage skill handler walks this id back
                // to the user message to read the parked candidate and seeds
                // the skill under the assistant group — instead of synthesizing
                // from the user prompt alone at inbound time. Resolved from
                // the final assistant message row when operation metadata omits
                // it (the server execAgent path).
                anchorMessageId: assistantMessageId,
                assistantMessageId,
                operationId,
                // Carry the completion reason so completion-stage consumers can
                // tell a finished turn from a non-terminal pause
                // (waiting_for_async_tool / waiting_for_human), which reuse this
                // same source.
                reason,
                // Self-iteration runs carry their finalState tool outcomes here
                // (the one point finalState is in hand) so the completion policy
                // can project receipts. Undefined for every other agent.
                selfIteration,
                serializedContext: undefined,
                steps: getLlmCallCount(state),
                topicId: runOrigin.topicId,
                turnCount: getLlmCallCount(state),
              },
              sourceId: `${operationId}:complete:${reason}`,
              sourceType: 'agent.execution.completed',
            },
            {
              agentId: runOrigin.agentId,
              db: deps.serverDB,
              userId: runOrigin.userId || deps.userId,
              workspaceId: deps.workspaceId,
            },
            { ignoreError: true },
          );

    log(
      '[completion-lifecycle] emission done op=%s reason=%s deduped=%s',
      operationId,
      reason,
      (completionSignalEmission as { deduped?: boolean } | undefined)?.deduped ?? 'n/a',
    );

    return toAgentSignalSnapshotEvents(completionSignalEmission);
  } catch (error) {
    log('[%s] Completion signal emission error (non-fatal): %O', operationId, error);
    return [];
  }
}
