import { type AgentLabelListItem } from '@lobechat/types';

import { createReplicaState, type ReplicaState } from '@/libs/replica';

export interface LabelState {
  /**
   * Agent label registry for the current scope (workspace-shared, or
   * personal outside a workspace). Includes archived labels — consumers
   * filter as needed.
   */
  agentLabels: AgentLabelListItem[];
  /**
   * Replica bookkeeping for the registry (the flat `agentLabels` field is its
   * view). The cache scope partitions the registry, so a scope switch counts
   * an already-loaded list as not-yet-loaded rather than as stale-but-usable:
   * applying a label id from the wrong scope is a destructive write, not a
   * cosmetic glitch.
   */
  agentLabelsReplica: ReplicaState<AgentLabelListItem[]>;
  /**
   * Whether the label list has been initialized
   */
  isAgentLabelsInit: boolean;
}

export const initialLabelState: LabelState = {
  agentLabels: [],
  agentLabelsReplica: createReplicaState(),
  isAgentLabelsInit: false,
};
