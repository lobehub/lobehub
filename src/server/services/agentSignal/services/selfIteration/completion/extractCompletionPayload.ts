import type { AgentState } from '@lobechat/agent-runtime';

import {
  type AgentSignalOperationMarker,
  readAgentSignalMarker,
} from '@/server/services/agentSignal/operationMarker';
import { resolveMemoryActionResultFromState } from '@/server/services/agentSignal/policies/analyzeIntent/actions/memoryActionResult';

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
 * Memory-writer runs use the generic memory builtin tool, whose results are NOT
 * `kind`-tagged, so `extractMutations` finds nothing. Re-derive the durable
 * outcome from the run's finalState (the same logic the synchronous runner used)
 * and synthesize a `writeMemory` mutation so the receipt projector treats it like
 * any other durable write. Only an applied write yields a mutation; skip / fail
 * leave the run with no durable receipt.
 */
const extractMemoryMutations = (finalState: AgentState): ToolResultWithKind[] => {
  const result = resolveMemoryActionResultFromState(finalState);
  if (result.status !== 'applied') return [];

  return [
    {
      apiName: 'writeMemory',
      data: {
        kind: 'mutation',
        resourceId: result.target?.id ?? result.target?.memoryId,
        status: 'applied',
        summary: result.detail,
      },
      kind: 'mutation',
    },
  ];
};

/**
 * Extracts the compact self-iteration completion payload from a terminal agent
 * state, or `undefined` when the run carried no agent-signal marker.
 *
 * Keyed on the operation marker (stamped at dispatch), NOT the agent slug — a
 * memory-writer run executes as the user's own agent, so a slug check would miss
 * it. Returns `undefined` (a safe no-op) for every unmarked run, keeping
 * completion inert until a dispatcher opts in by stamping the marker.
 */
export const extractSelfIterationCompletionPayload = (
  state: unknown,
): SelfIterationCompletionPayload | undefined => {
  if (!isRecord(state)) return undefined;
  const metadata = isRecord(state.metadata) ? state.metadata : undefined;
  if (!metadata) return undefined;

  const marker = readAgentSignalMarker(metadata);
  if (!marker) return undefined;

  const userId = typeof metadata.userId === 'string' ? metadata.userId : undefined;
  if (!userId) return undefined;

  const finalState = state as unknown as AgentState;

  if (marker.kind === 'memory') {
    return { artifacts: [], marker, mutations: extractMemoryMutations(finalState), userId };
  }

  return {
    artifacts: extractArtifacts(finalState),
    marker,
    mutations: extractMutations(finalState),
    userId,
  };
};
