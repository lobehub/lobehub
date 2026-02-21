import { type SidebarAgentItem, type SidebarGroup } from '@/database/repositories/home';
import { type HomeStore } from '@/store/home/store';

/**
 * Get all pinned agents
 */
const pinnedAgents = (s: HomeStore): SidebarAgentItem[] => s.pinnedAgents;

/**
 * Get all agent groups (folders)
 */
const agentGroups = (s: HomeStore): SidebarGroup[] => s.agentGroups;

/**
 * Get all ungrouped agents
 */
const ungroupedAgents = (s: HomeStore): SidebarAgentItem[] => s.ungroupedAgents;

/**
 * Limit ungrouped agents for sidebar display based on page size
 */
const ungroupedAgentsLimited =
  (pageSize: number) =>
  (s: HomeStore): SidebarAgentItem[] =>
    s.ungroupedAgents.slice(0, pageSize);

/**
 * Get ungrouped agents count
 */
const ungroupedAgentsCount = (s: HomeStore): number => s.ungroupedAgents.length;

/**
 * Check if agent list is initialized
 */
const isAgentListInit = (s: HomeStore): boolean => s.isAgentListInit;

/**
 * Get all agents (pinned + grouped + ungrouped)
 */
const allAgents = (s: HomeStore): SidebarAgentItem[] => {
  const groupedAgents = s.agentGroups.flatMap((g) => g.items);
  return [...s.pinnedAgents, ...groupedAgents, ...s.ungroupedAgents];
};

/**
 * Get agent by id
 */
const getAgentById =
  (id: string) =>
  (s: HomeStore): SidebarAgentItem | undefined => {
    return allAgents(s).find((a) => a.id === id);
  };

/**
 * Check if there are any custom agents (non-empty list)
 */
const hasCustomAgents = (s: HomeStore): boolean => {
  return allAgents(s).length > 0;
};

/**
 * Get total agent count
 */
const agentCount = (s: HomeStore): number => {
  return allAgents(s).length;
};

export const homeAgentListSelectors = {
  agentCount,
  agentGroups,
  allAgents,
  getAgentById,
  hasCustomAgents,
  isAgentListInit,
  pinnedAgents,
  ungroupedAgents,
  ungroupedAgentsCount,
  ungroupedAgentsLimited,
};
