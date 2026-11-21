import { type MarketUserProfile } from '@/layout/AuthProvider/MarketAuth/types';
import { createReplicaState, type ReplicaState } from '@/libs/replica';
import { type MarketSkillPackageFile } from '@/services/marketApi';
import type {
  AgentForkSourceResponse,
  AgentGroupForkSourceResponse,
  AssistantListResponse,
} from '@/types/discover';

import { type MarketAgentGroupStatus, type MarketAgentStatus } from './projection';

/**
 * Replica views of the market reads around one published agent, group or
 * skill, each beside its bookkeeping slot. Components read them through
 * `marketSelectors`, never through the fetch hook.
 */
export interface MarketSliceState {
  /** Fork source per agent identifier. */
  agentForkSourceMap: Record<string, AgentForkSourceResponse>;
  /** Replica bookkeeping of `agentForkSourceMap`. */
  agentForkSourceReplica: ReplicaState<AgentForkSourceResponse>;
  /** Fork source per group identifier. */
  agentGroupForkSourceMap: Record<string, AgentGroupForkSourceResponse>;
  /** Replica bookkeeping of `agentGroupForkSourceMap`. */
  agentGroupForkSourceReplica: ReplicaState<AgentGroupForkSourceResponse>;
  /** Review status per group identifier. */
  marketAgentGroupStatusMap: Record<string, MarketAgentGroupStatus>;
  /** Replica bookkeeping of `marketAgentGroupStatusMap`. */
  marketAgentGroupStatusReplica: ReplicaState<MarketAgentGroupStatus>;
  /** Publish status per agent identifier. */
  marketAgentStatusMap: Record<string, MarketAgentStatus>;
  /** Replica bookkeeping of `marketAgentStatusMap`. */
  marketAgentStatusReplica: ReplicaState<MarketAgentStatus>;
  /** The viewer's Market profile per username. */
  marketUserProfileMap: Record<string, MarketUserProfile>;
  /** Replica bookkeeping of `marketUserProfileMap`. */
  marketUserProfileReplica: ReplicaState<MarketUserProfile>;
  /** Agents using a plugin, per page (`pluginAgentsQueryKey`). */
  pluginAgentsMap: Record<string, AssistantListResponse>;
  /** Replica bookkeeping of `pluginAgentsMap`. */
  pluginAgentsReplica: ReplicaState<AssistantListResponse>;
  /** Package text files per skill identifier. */
  skillPackageFilesMap: Record<string, MarketSkillPackageFile[]>;
  /** Replica bookkeeping of `skillPackageFilesMap`. */
  skillPackageFilesReplica: ReplicaState<MarketSkillPackageFile[]>;
}

export const initialMarketSliceState: MarketSliceState = {
  agentForkSourceMap: {},
  agentForkSourceReplica: createReplicaState(),
  agentGroupForkSourceMap: {},
  agentGroupForkSourceReplica: createReplicaState(),
  marketAgentGroupStatusMap: {},
  marketAgentGroupStatusReplica: createReplicaState(),
  marketAgentStatusMap: {},
  marketAgentStatusReplica: createReplicaState(),
  marketUserProfileMap: {},
  marketUserProfileReplica: createReplicaState(),
  pluginAgentsMap: {},
  pluginAgentsReplica: createReplicaState(),
  skillPackageFilesMap: {},
  skillPackageFilesReplica: createReplicaState(),
};
