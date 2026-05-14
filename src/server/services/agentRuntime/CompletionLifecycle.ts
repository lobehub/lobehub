import debug from 'debug';

import {
  AgentOperationModel,
  type RecordOperationStartParams,
} from '@/database/models/agentOperation';
import { MessageModel } from '@/database/models/message';
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
  private readonly messageModel: MessageModel;
  private readonly agentOperationModel: AgentOperationModel;

  constructor(
    private readonly serverDB: LobeChatDatabase,
    private readonly userId: string,
  ) {
    this.messageModel = new MessageModel(serverDB, userId);
    this.agentOperationModel = new AgentOperationModel(serverDB, userId);
  }

  /**
   * Persist the initial `agent_operations` row when an operation is created.
   * Fire-and-forget: a DB outage here must never block the runtime startup
   * path — `dispatchHooks` will still finalize the row if one was written.
   */
  async recordStart(params: RecordOperationStartParams): Promise<void> {
    try {
      await this.agentOperationModel.recordStart(params);
    } catch (error) {
      log('[%s] Failed to record operation start (non-fatal): %O', params.operationId, error);
    }
  }

  /**
   * Map a completion reason to the terminal `agent_operations.status` value.
   * `waiting_for_human` keeps `status='waiting_for_human'` so analytics can
   * distinguish paused ops from terminal ones.
   */
  private statusForReason(reason: string): 'done' | 'error' | 'interrupted' | 'waiting_for_human' {
    switch (reason) {
      case 'error': {
        return 'error';
      }
      case 'interrupted': {
        return 'interrupted';
      }
      case 'waiting_for_human': {
        return 'waiting_for_human';
      }
      default: {
        return 'done';
      }
    }
  }

  /**
   * Persist terminal state to `agent_operations`. Fire-and-forget: a DB
   * outage must never block hook dispatch or the executor's terminal
   * cleanup path.
   */
  private async persistCompletion(operationId: string, state: any, reason: string): Promise<void> {
    const completionReason: any =
      reason === 'max_steps' || reason === 'cost_limit' || reason === 'waiting_for_human'
        ? reason
        : this.statusForReason(reason);

    const metadata = state?.metadata ?? {};
    const agentId = metadata?.agentId;
    const topicId = metadata?.topicId;
    const traceS3Key =
      agentId && topicId ? `agent-traces/${agentId}/${topicId}/${operationId}.json` : null;

    const processingTimeMs = state?.createdAt
      ? Date.now() - new Date(state.createdAt).getTime()
      : null;

    const status = this.statusForReason(reason);
    // `waiting_for_human` is a pause, not a true terminal state — leave
    // completedAt null so analytics doesn't read a paused op as completed.
    // The next dispatchHooks call (when the human resumes and the op truly
    // ends) will overwrite both fields.
    const completedAt = status === 'waiting_for_human' ? undefined : new Date();

    try {
      await this.agentOperationModel.recordCompletion(operationId, {
        completedAt,
        completionReason,
        cost: state?.cost ?? null,
        error: state?.error ?? null,
        interruption: state?.interruption ?? null,
        llmCalls: state?.usage?.llm?.apiCalls ?? null,
        processingTimeMs,
        status,
        stepCount: state?.stepCount ?? null,
        toolCalls: state?.usage?.tools?.totalCalls ?? null,
        totalCost: state?.cost?.total ?? null,
        totalInputTokens: state?.usage?.llm?.tokens?.input ?? null,
        totalOutputTokens: state?.usage?.llm?.tokens?.output ?? null,
        totalTokens: state?.usage?.llm?.tokens?.total ?? null,
        traceS3Key,
        usage: state?.usage ?? null,
      });
    } catch (error) {
      log('[%s] Failed to persist operation completion (non-fatal): %O', operationId, error);
    }
  }

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

      // Finalize the agent_operations row before user hooks fire so
      // downstream consumers see the row in its terminal shape.
      await this.persistCompletion(operationId, state, reason);

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
