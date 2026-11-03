import { createReplicaState, type ReplicaState } from '@/libs/replica';

import type { AgentSkillDetail, AgentSkillListItem } from './projection';

export interface AgentSkillsState {
  /** Replica view of the loaded skill details, one entry per skill id. */
  agentSkillDetailMap: Record<string, AgentSkillDetail>;
  /** Replica bookkeeping of `agentSkillDetailMap`. */
  agentSkillDetailReplica: ReplicaState<AgentSkillDetail>;
  /** Replica view of the installed skills, one entry per scope (`AGENT_SKILL_LIST_KEY`). */
  agentSkillListMap: Record<string, AgentSkillListItem[]>;
  /** Replica bookkeeping of `agentSkillListMap`. */
  agentSkillListReplica: ReplicaState<AgentSkillListItem[]>;
}

export const initialAgentSkillsState: AgentSkillsState = {
  agentSkillDetailMap: {},
  agentSkillDetailReplica: createReplicaState(),
  agentSkillListMap: {},
  agentSkillListReplica: createReplicaState(),
};
