import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';
import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';

import { defineAgentSignalHandlers, defineSourceHandler } from '../runtime/middleware';

/**
 * Handles `agent.execution.completed` source events emitted after every execAgent run
 * (including builtin background agents). Routes builtin self-iteration runs to an
 * optional caller callback so side-effects (brief writing, receipt projection,
 * idempotency marker) can happen asynchronously after the agent run finishes.
 *
 * Mode-specific dispatch (review / reflection / feedback) is deferred — the
 * caller can demultiplex by looking up the operation row and inspecting the
 * stored scope / iteration mode at callback time.
 *
 * The callback is fire-and-forget from the worker's perspective; failures are
 * logged but never re-trigger the source pipeline.
 *
 * NOTE on userId: the `agent.execution.completed` source payload does not carry
 * userId, and `AgentSignalSource.scope` is not populated by renderers. Callers
 * that need userId should look it up via the operations table by `operationId`.
 */
export interface CompletionCallbackParams {
  agentId: string;
  operationId: string;
  /** Optional topic id forwarded from the source payload. */
  topicId?: string;
}

export interface CreateCompletionPolicyOptions {
  /** Called when a self-iteration run completes (any mode: review / reflection / feedback). */
  onSelfIterationCompleted?: (params: CompletionCallbackParams) => Promise<void>;
}

export const createCompletionPolicy = (options: CreateCompletionPolicyOptions = {}) =>
  defineAgentSignalHandlers([
    defineSourceHandler(
      AGENT_SIGNAL_SOURCE_TYPES.agentExecutionCompleted,
      'agent.execution.completed:completion-fanout',
      async (source) => {
        const { agentId, operationId, topicId } = source.payload;

        if (!agentId || !operationId) return;
        if (agentId !== BUILTIN_AGENT_SLUGS.selfIteration) return;
        if (!options.onSelfIterationCompleted) return;

        const params: CompletionCallbackParams = {
          agentId,
          operationId,
          ...(topicId ? { topicId } : {}),
        };

        try {
          await options.onSelfIterationCompleted(params);
        } catch (error) {
          // Non-fatal: completion policy failures must not block the AgentSignal worker
          // or cause source re-processing.
          console.error('[completionPolicy] post-completion handler failed', { agentId, error });
        }
      },
    ),
  ]);
