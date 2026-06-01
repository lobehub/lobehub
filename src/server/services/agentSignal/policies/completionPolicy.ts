import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';
import type { BuiltinAgentSlug } from '@lobechat/builtin-agents';
import { SELF_ITERATION_AGENT_SLUGS } from '@lobechat/builtin-agents';

import { defineAgentSignalHandlers, defineSourceHandler } from '../runtime/middleware';
import type { SelfIterationCompletionPayload } from '../services/selfIteration/completion';

/**
 * Handles `agent.execution.completed` source events emitted after every execAgent run
 * (including builtin background agents). Routes builtin self-iteration runs
 * (nightly-review / self-reflection / self-feedback-intent) to an optional
 * caller callback so side-effects (brief writing, receipt projection,
 * idempotency marker) can happen asynchronously after the agent run finishes.
 *
 * Mode is carried by `agentId` itself — each self-iteration mode is a distinct
 * builtin agent slug, so callers can dispatch on `agentId` without needing to
 * read the operation row.
 *
 * The callback is fire-and-forget from the worker's perspective; failures are
 * logged but never re-trigger the source pipeline.
 *
 * NOTE on userId: the `agent.execution.completed` source payload does not carry
 * userId, and `AgentSignalSource.scope` is not populated by renderers. Callers
 * that need userId should look it up via the operations table by `operationId`.
 */
export interface CompletionCallbackParams {
  /** Self-iteration agent slug — caller dispatches mode-specific behaviour from this. */
  agentId: BuiltinAgentSlug;
  operationId: string;
  /**
   * Compact self-iteration tool outcomes + run marker, extracted from the run's
   * finalState by the executor and carried on the completion payload. Absent for
   * runs that did not stamp an agent-signal marker.
   */
  selfIteration?: SelfIterationCompletionPayload;
  /** Optional topic id forwarded from the source payload. */
  topicId?: string;
}

export interface CreateCompletionPolicyOptions {
  /**
   * Called when a self-iteration run completes. `params.agentId` identifies
   * which mode (nightly-review / self-reflection / self-feedback-intent) ran.
   */
  onSelfIterationCompleted?: (params: CompletionCallbackParams) => Promise<void>;
}

export const createCompletionPolicy = (options: CreateCompletionPolicyOptions = {}) =>
  defineAgentSignalHandlers([
    defineSourceHandler(
      AGENT_SIGNAL_SOURCE_TYPES.agentExecutionCompleted,
      'agent.execution.completed:completion-fanout',
      async (source) => {
        const { agentId, operationId, selfIteration, topicId } = source.payload;

        if (!agentId || !operationId) return;
        if (!SELF_ITERATION_AGENT_SLUGS.has(agentId as BuiltinAgentSlug)) return;
        if (!options.onSelfIterationCompleted) return;

        const params: CompletionCallbackParams = {
          agentId: agentId as BuiltinAgentSlug,
          operationId,
          ...(selfIteration
            ? { selfIteration: selfIteration as SelfIterationCompletionPayload }
            : {}),
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
