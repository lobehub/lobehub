import { AgentSignalReviewContextModel } from '@/database/models/agentSignal/reviewContext';
import { AGENT_SIGNAL_DEFAULTS } from '@/server/services/agentSignal/constants';
import { redisSourceEventStore } from '@/server/services/agentSignal/store/adapters/redis/sourceEventStore';

import type { CreateServerSelfIterationPolicyOptions } from '../server';
import { canRunSelfIterationSource } from '../server';
import type { CreateSelfFeedbackIntentSourceHandlerDependencies } from './handler';

/**
 * Creates server self-feedback intent policy options for the Agent Signal workflow.
 *
 * Call stack:
 *
 * runAgentSignalWorkflow
 *   -> {@link createServerSelfFeedbackIntentPolicyOptions}
 *     -> intent source handler dependencies
 *       -> {@link enqueueSelfIterationRun} (async execAgent under the builtin slug)
 *
 * The handler only gates, dedupes, enriches bounded evidence, and dispatches an
 * async run. The self-iteration tools are resolved server-side from
 * `plugins: ['agent-signal-feedback-intent']` by the builtin self-feedback-intent
 * agent's serverRuntime — there is no inline model runtime, toolset, or receipt
 * writer here anymore.
 *
 * Expects:
 * - The source was emitted by `declareSelfFeedbackIntent`
 * - The handler will re-check gates and idempotency before dispatch
 *
 * Returns:
 * - Intent handler options ready for `createDefaultAgentSignalPolicies`
 */
export const createServerSelfFeedbackIntentPolicyOptions = ({
  agentId,
  db,
  selfIterationEnabled = false,
  userId,
  workspaceId,
}: CreateServerSelfIterationPolicyOptions): CreateSelfFeedbackIntentSourceHandlerDependencies => {
  const reviewContextModel = new AgentSignalReviewContextModel(db, userId, workspaceId);

  return {
    acquireReviewGuard: (input) =>
      redisSourceEventStore.tryDedupe(
        `self-feedback-intent-guard:${input.guardKey}`,
        AGENT_SIGNAL_DEFAULTS.receiptTtlSeconds,
      ),
    canRunReview: async (input) => {
      if (input.userId !== userId) return false;

      return canRunSelfIterationSource({
        agentId: input.agentId,
        expectedAgentId: agentId,
        reviewContextModel,
        selfIterationEnabled,
      });
    },
    db,
    enrichEvidence: async (input) => ({
      evidenceRefs: [
        {
          id: input.scopeId,
          type: input.scopeType,
        },
      ],
    }),
    workspaceId,
  };
};
