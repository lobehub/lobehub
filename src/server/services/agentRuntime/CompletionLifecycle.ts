import debug from 'debug';

import type { MessageModel } from '@/database/models/message';
import { type LobeChatDatabase } from '@/database/type';
import { emitAgentSignalSourceEvent } from '@/server/services/agentSignal';
import { toAgentSignalTraceEvents } from '@/server/services/agentSignal/observability/traceEvents';

import { hookDispatcher } from './hooks';

const log = debug('lobe-server:completion-lifecycle');

type SignalEvent = { [key: string]: unknown; type: string };

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
 * Owns everything that happens once an operation reaches a terminal state:
 * building the lifecycle event payload, emitting completion AgentSignal source
 * events, dispatching `onComplete`/`onError` hooks, and writing the final
 * error back onto the assistant message row.
 *
 * All public methods are fire-and-forget: errors are logged but never thrown,
 * so the executor's terminal cleanup path (snapshot finalize, lock release)
 * always runs.
 */
export class CompletionLifecycle {
  constructor(
    private readonly serverDB: LobeChatDatabase,
    private readonly userId: string,
    private readonly messageModel: MessageModel,
  ) {}

  /**
   * Extract a human-readable error message from the agent state error object.
   * Handles both raw `ChatCompletionErrorPayload` (from runtime.step catch) and
   * formatted `ChatMessageError` (from executeStep catch).
   *
   * Public so callers can use the same formatting when surfacing errors
   * outside the hook dispatch path (e.g. trace snapshot finalize).
   */
  extractErrorMessage(error: any): string | undefined {
    if (!error) return undefined;

    // Path B: formatted ChatMessageError — { body, message, type }
    if (error.body) {
      const body = error.body;
      // OpenAI-style: body.error.message
      if (body.error?.message) return body.error.message;
      if (body.message) return body.message;
    }

    // Path A: raw ChatCompletionErrorPayload — { errorType, error: {...}, provider }
    if (error.error) {
      const inner = error.error;
      if (inner.error?.message) return inner.error.message;
      if (inner.message) return inner.message;
    }

    if (error.message && error.message !== 'error') return error.message;
    if (error.type || error.errorType) return String(error.type || error.errorType);

    return undefined;
  }

  /**
   * Emit completion AgentSignal source events and return compact snapshot
   * events for attachment to the trace step. Fire-and-forget.
   */
  async emitSignalEvents(operationId: string, state: any, reason: string): Promise<SignalEvent[]> {
    try {
      const { metadata } = this.buildLifecycleEvent(operationId, state, reason);
      const completionSignalEmission =
        reason === 'error'
          ? await emitAgentSignalSourceEvent(
              {
                payload: {
                  agentId: metadata?.agentId,
                  errorMessage: this.extractErrorMessage(state?.error),
                  operationId,
                  reason,
                  serializedContext: undefined,
                  topicId: metadata?.topicId,
                  turnCount: state?.stepCount || 0,
                },
                sourceId: `${operationId}:complete:${reason}`,
                sourceType: 'agent.execution.failed',
              },
              {
                agentId: metadata?.agentId,
                db: this.serverDB,
                userId: metadata?.userId || this.userId,
              },
              { ignoreError: true },
            )
          : await emitAgentSignalSourceEvent(
              {
                payload: {
                  agentId: metadata?.agentId,
                  operationId,
                  serializedContext: undefined,
                  steps: state?.stepCount || 0,
                  topicId: metadata?.topicId,
                  turnCount: state?.stepCount || 0,
                },
                sourceId: `${operationId}:complete:${reason}`,
                sourceType: 'agent.execution.completed',
              },
              {
                agentId: metadata?.agentId,
                db: this.serverDB,
                userId: metadata?.userId || this.userId,
              },
              { ignoreError: true },
            );

      return toAgentSignalSnapshotEvents(completionSignalEmission);
    } catch (error) {
      log('[%s] Completion signal emission error (non-fatal): %O', operationId, error);
      return [];
    }
  }

  /**
   * Dispatch `onComplete` (and `onError` for `reason='error'`) hooks via
   * the global `hookDispatcher`. On the error path, also writes the error
   * back onto the assistant message row so the frontend can render it.
   * Fire-and-forget; always unregisters the operation from the dispatcher.
   */
  async dispatchHooks(operationId: string, state: any, reason: string): Promise<void> {
    try {
      const { event, metadata } = this.buildLifecycleEvent(operationId, state, reason);

      await hookDispatcher.dispatch(operationId, 'onComplete', event, metadata._hooks);

      if (reason === 'error') {
        await hookDispatcher.dispatch(operationId, 'onError', event, metadata._hooks);

        const assistantMessageId = metadata?.assistantMessageId;
        if (assistantMessageId && state?.error) {
          const errorMessage = this.extractErrorMessage(state.error) || String(state.error);
          try {
            await this.messageModel.update(assistantMessageId, {
              error: {
                body: { message: errorMessage },
                message: errorMessage,
                type: 'AgentRuntimeError',
              },
            });
          } catch (updateError) {
            log(
              '[%s] Failed to update assistant message with error (non-fatal): %O',
              operationId,
              updateError,
            );
          }
        }
      }
    } catch (error) {
      log('[%s] Hook dispatch error (non-fatal): %O', operationId, error);
    } finally {
      hookDispatcher.unregister(operationId);
    }
  }

  private buildLifecycleEvent(operationId: string, state: any, reason: string) {
    const metadata = state?.metadata || {};
    const lastAssistantContent = state?.messages
      ?.slice()
      .reverse()
      .find(
        (m: { content?: string; role: string }) => m.role === 'assistant' && m.content,
      )?.content;
    const duration = state?.createdAt
      ? Date.now() - new Date(state.createdAt).getTime()
      : undefined;

    return {
      event: {
        agentId: metadata?.agentId || '',
        cost: state?.cost?.total,
        duration,
        errorDetail: state?.error,
        errorMessage: this.extractErrorMessage(state?.error) || String(state?.error || ''),
        finalState: state,
        lastAssistantContent,
        llmCalls: state?.usage?.llm?.apiCalls,
        operationId,
        reason,
        status: state?.status || reason,
        steps: state?.stepCount || 0,
        toolCalls: state?.usage?.tools?.totalCalls,
        topicId: metadata?.topicId,
        totalTokens: state?.usage?.llm?.tokens?.total,
        userId: metadata?.userId || this.userId,
      },
      metadata,
    };
  }
}
