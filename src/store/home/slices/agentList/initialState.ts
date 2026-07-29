import {
  type SidebarAgentItem,
  type SidebarAgentListResponse,
  type SidebarGroup,
} from '@/database/repositories/home';

export interface AgentListState {
  /**
   * Agent groups (user-defined folders)
   */
  agentGroups: SidebarGroup[];
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
  allAgentsDrawerOpen: false,
  isAgentListInit: false,
  pinnedAgents: [],
  privateAgentGroups: [],
  privatePinnedAgents: [],
  privateUngroupedAgents: [],
  ungroupedAgents: [],
};

/**
 * Helper to update state from API response
 */
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
