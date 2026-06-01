import type { AgentState } from '@lobechat/agent-runtime';
import type { BuiltinAgentSlug } from '@lobechat/builtin-agents';
import { SELF_ITERATION_AGENT_SLUGS } from '@lobechat/builtin-agents';

import {
  type AgentSignalOperationMarker,
  readAgentSignalMarker,
} from '@/server/services/agentSignal/operationMarker';

import {
  extractArtifacts,
  extractMutations,
  type ToolResultWithKind,
} from '../finalStateExtractor';

/**
 * Compact self-iteration completion data, extracted from the run's finalState at
 * the one point it is in hand (the completion lifecycle) and carried on the
 * `agent.execution.completed` source payload. Holds only the kind-tagged tool
 * outcomes (small) + the run marker + owner — never the full message history.
 */
export interface SelfIterationCompletionPayload {
  /** Non-actionable idea / intent recorder outputs. */
  artifacts: ToolResultWithKind[];
  /** Run marker stamped at dispatch (kind / sourceId / window / anchors). */
  marker: AgentSignalOperationMarker;
  /** Durable write tool outputs. */
  mutations: ToolResultWithKind[];
  /** Owner — the completion source payload does not carry userId. */
  userId: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Extracts the compact self-iteration completion payload from a terminal agent
 * state, or `undefined` when the run is not a marked self-iteration run.
 *
 * Returns `undefined` (a safe no-op) unless the agent is a self-iteration slug
 * AND the operation carries an agent-signal marker — so completion stays inert
 * until the dispatch side stamps the marker (S3 / S4).
 */
export const extractSelfIterationCompletionPayload = (
  state: unknown,
): SelfIterationCompletionPayload | undefined => {
  if (!isRecord(state)) return undefined;
  const metadata = isRecord(state.metadata) ? state.metadata : undefined;
  if (!metadata) return undefined;

  const agentId = typeof metadata.agentId === 'string' ? metadata.agentId : undefined;
  if (!agentId || !SELF_ITERATION_AGENT_SLUGS.has(agentId as BuiltinAgentSlug)) return undefined;

  const marker = readAgentSignalMarker(metadata);
  if (!marker) return undefined;

  const userId = typeof metadata.userId === 'string' ? metadata.userId : undefined;
  if (!userId) return undefined;

  const finalState = state as unknown as AgentState;

  return {
    artifacts: extractArtifacts(finalState),
    marker,
    mutations: extractMutations(finalState),
    userId,
  };
};
