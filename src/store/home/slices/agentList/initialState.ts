import {
  type SidebarAgentItem,
  type SidebarAgentListResponse,
  type SidebarGroup,
} from '@lobechat/types';

import { createReplicaState, type ReplicaState } from '@/libs/replica';
import type { AgentMetaUpdate } from '@/store/agent/slices/agent/action';

export type SidebarAgentMetaPatch = Pick<
  AgentMetaUpdate,
  'avatar' | 'backgroundColor' | 'description' | 'name' | 'title'
>;

export interface AgentListState {
  /**
   * Agent groups (user-defined folders)
   */
  agentGroups: SidebarGroup[];
  /** Replica bookkeeping for the sidebar agent list (the flat fields are its view). */
  agentListReplica: ReplicaState<SidebarAgentListResponse>;
  /**
   * Whether all agents drawer is open
   */
  allAgentsDrawerOpen: boolean;
  /**
   * Whether the agent list has been initialized
   */
  isAgentListInit: boolean;
  /**
   * Pinned agents and chat groups
   */
  pinnedAgents: SidebarAgentItem[];
  /**
   * Private folders owned by the current user within the workspace.
   * Always empty in personal mode.
   */
  privateAgentGroups: SidebarGroup[];
  /**
   * Pinned private agents/chat groups owned by the current user within the
   * workspace. Rendered at the top of the Private section, never in the
   * public pinned list. Always empty in personal mode.
   */
  privatePinnedAgents: SidebarAgentItem[];
  /**
   * Ungrouped private agents/chat groups owned by the current user within
   * the workspace. Always empty in personal mode.
   */
  privateUngroupedAgents: SidebarAgentItem[];
  /**
   * Ungrouped agents and chat groups
   */
  ungroupedAgents: SidebarAgentItem[];
}

export const initialAgentListState: AgentListState = {
  agentGroups: [],
  agentListReplica: createReplicaState(),
  allAgentsDrawerOpen: false,
  isAgentListInit: false,
  pinnedAgents: [],
  privateAgentGroups: [],
  privatePinnedAgents: [],
  privateUngroupedAgents: [],
  ungroupedAgents: [],
};

/** The view fields an agent list response is spread into. */
export const mapResponseToState = (
  response: SidebarAgentListResponse,
): Pick<
  AgentListState,
  | 'agentGroups'
  | 'pinnedAgents'
  | 'privateAgentGroups'
  | 'privatePinnedAgents'
  | 'privateUngroupedAgents'
  | 'ungroupedAgents'
> => ({
  agentGroups: response.groups,
  pinnedAgents: response.pinned,
  privateAgentGroups: response.privateGroups ?? [],
  privatePinnedAgents: response.privatePinned ?? [],
  privateUngroupedAgents: response.privateUngrouped ?? [],
  ungroupedAgents: response.ungrouped,
});

/** Inverse of {@link mapResponseToState}: the replica value behind the flat fields. */
export const mapStateToResponse = (state: AgentListState): SidebarAgentListResponse => ({
  groups: state.agentGroups,
  pinned: state.pinnedAgents,
  privateGroups: state.privateAgentGroups,
  privatePinned: state.privatePinnedAgents,
  privateUngrouped: state.privateUngroupedAgents,
  ungrouped: state.ungroupedAgents,
});
