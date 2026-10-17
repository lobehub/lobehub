import { type AgentItem } from '@lobechat/types';

import { createReplicaState, type ReplicaState } from '@/libs/replica';

export interface BuiltinAgentSliceState {
  /**
   * Builtin agent id mapping { [slug]: agentId }
   * Used to store IDs of builtin agents (page-agent, etc.)
   *
   * Derived from {@link builtinAgentMap} by the replica lens, so the two never
   * disagree; kept as its own field because selectors and route loaders read it
   * directly.
   */
  builtinAgentIdMap: Record<string, string>;
  /** Replica view of each builtin agent, keyed by slug. */
  builtinAgentMap: Record<string, AgentItem>;
  /** Replica bookkeeping of `builtinAgentMap`. */
  builtinAgentReplica: ReplicaState<AgentItem>;
}

export const initialBuiltinAgentSliceState: BuiltinAgentSliceState = {
  builtinAgentIdMap: {},
  builtinAgentMap: {},
  builtinAgentReplica: createReplicaState(),
};
