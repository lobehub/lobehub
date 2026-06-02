import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';

import { defineAgentSignalHandlers, defineSourceHandler } from '../runtime/middleware';
import type { SelfIterationCompletionPayload } from '../services/selfIteration/completion';

/**
 * Handles `agent.execution.completed` source events emitted after every execAgent
 * run. Routes runs that stamped an agent-signal marker (nightly-review /
 * self-reflection / self-feedback-intent / memory) to an optional caller
 * callback so side-effects (receipt projection) can happen asynchronously after
 * the agent run finishes.
 *
 * Routing is keyed on the marker-derived `selfIteration` payload, NOT the agent
 * slug: a memory-writer run executes as the user's own agent, so a slug check
 * would miss it. The marker is the authoritative "this run wants completion-side
 * projection" signal, stamped by the dispatcher.
 *
 * The callback is fire-and-forget from the worker's perspective; failures are
 * logged but never re-trigger the source pipeline.
 */
export interface CompletionCallbackParams {
  /** Agent that ran — a builtin self-iteration slug, or a user agent for memory. */
  agentId: string;
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
        // Marker-driven: only runs that stamped a marker carry a selfIteration
        // payload. Unmarked runs have nothing to project.
        if (!selfIteration) return;
        if (!options.onSelfIterationCompleted) return;

        const params: CompletionCallbackParams = {
          agentId,
          operationId,
          selfIteration: selfIteration as SelfIterationCompletionPayload,
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
