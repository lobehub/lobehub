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
   * Ungrouped agents and chat groups
   */
  ungroupedAgents: SidebarAgentItem[];
}

export const initialAgentListState: AgentListState = {
  agentGroups: [],
  allAgentsDrawerOpen: false,
  isAgentListInit: false,
  pinnedAgents: [],
  ungroupedAgents: [],
};

/**
 * Helper to update state from API response
 */
export const mapResponseToState = (
  response: SidebarAgentListResponse,
): Pick<AgentListState, 'agentGroups' | 'pinnedAgents' | 'ungroupedAgents'> => ({
  agentGroups: response.groups,
  pinnedAgents: response.pinned,
  ungroupedAgents: response.ungrouped,
});
