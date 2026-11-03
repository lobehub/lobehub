import { createReplicaState, type ReplicaState } from '@/libs/replica';

import type { AgentDocumentSkillItem } from './projection';

export type { AgentDocumentSkillItem } from './projection';

export interface AgentDocumentSkillsState {
  /**
   * Skill bundles per agent, keyed by `agentId`. Each agent is its own replica
   * entry, so switching agents paints the cached bundles at once and never
   * leaks the previous agent's items.
   */
  agentDocumentSkillsMap: Record<string, AgentDocumentSkillItem[]>;
  /** Replica bookkeeping for `agentDocumentSkillsMap`. */
  agentDocumentSkillsReplica: ReplicaState<AgentDocumentSkillItem[]>;
}

export const initialAgentDocumentSkillsState: AgentDocumentSkillsState = {
  agentDocumentSkillsMap: {},
  agentDocumentSkillsReplica: createReplicaState(),
};
