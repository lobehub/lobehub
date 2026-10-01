import { type SidebarAgentItem, type SidebarGroup } from '@/database/repositories/home';
import { type HomeStore } from '@/store/home/store';

const applyOptimisticPatch = (item: SidebarAgentItem, state: HomeStore): SidebarAgentItem => {
  const optimistic = state.agentOptimisticPatches[item.id];
  return optimistic?.scope === state.agentListScope ? { ...item, ...optimistic.patch } : item;
};

const applyOptimisticPatches = (items: SidebarAgentItem[], state: HomeStore) =>
  Object.keys(state.agentOptimisticPatches).length === 0
    ? items
    : items.map((item) => applyOptimisticPatch(item, state));

const applyGroupOptimisticPatches = (groups: SidebarGroup[], state: HomeStore) =>
  Object.keys(state.agentOptimisticPatches).length === 0
    ? groups
    : groups.map((group) => ({ ...group, items: applyOptimisticPatches(group.items, state) }));

/**
 * Get all pinned agents
 */
const pinnedAgents = (s: HomeStore): SidebarAgentItem[] =>
  applyOptimisticPatches(s.pinnedAgents, s);

/**
 * Get all agent groups (folders)
 */
const agentGroups = (s: HomeStore): SidebarGroup[] => applyGroupOptimisticPatches(s.agentGroups, s);

/**
 * Get private agent groups (folders) owned by the current user.
 * Empty array in personal mode.
 */
const privateAgentGroups = (s: HomeStore): SidebarGroup[] =>
  applyGroupOptimisticPatches(s.privateAgentGroups, s);

/**
 * Get pinned private agents owned by the current user.
 * Empty array in personal mode.
 */
const privatePinnedAgents = (s: HomeStore): SidebarAgentItem[] =>
  applyOptimisticPatches(s.privatePinnedAgents, s);

/**
 * Get all ungrouped agents
 */
const ungroupedAgents = (s: HomeStore): SidebarAgentItem[] =>
  applyOptimisticPatches(s.ungroupedAgents, s);

/**
 * Get ungrouped private agents owned by the current user.
 * Empty array in personal mode.
 */
const privateUngroupedAgents = (s: HomeStore): SidebarAgentItem[] =>
  applyOptimisticPatches(s.privateUngroupedAgents, s);

/**
 * Whether the current user has any private content in this workspace.
 */
const hasPrivateAgents = (s: HomeStore): boolean =>
  s.privateAgentGroups.length > 0 ||
  s.privatePinnedAgents.length > 0 ||
  s.privateUngroupedAgents.length > 0;

/**
 * Limit ungrouped agents for sidebar display based on page size
 */
const ungroupedAgentsLimited =
  (pageSize: number) =>
  (s: HomeStore): SidebarAgentItem[] =>
    applyOptimisticPatches(s.ungroupedAgents.slice(0, pageSize), s);

/**
 * Limit private ungrouped agents for the Private sidebar bucket
 */
const privateUngroupedAgentsLimited =
  (pageSize: number) =>
  (s: HomeStore): SidebarAgentItem[] =>
    applyOptimisticPatches(s.privateUngroupedAgents.slice(0, pageSize), s);

/**
 * Get ungrouped agents count
 */
const ungroupedAgentsCount = (s: HomeStore): number => s.ungroupedAgents.length;

/**
 * Get private ungrouped agents count
 */
const privateUngroupedAgentsCount = (s: HomeStore): number => s.privateUngroupedAgents.length;

/**
 * Check if agent list is initialized
 */
const isAgentListInit = (s: HomeStore): boolean => s.isAgentListInit;

/**
 * Get all agents (pinned + grouped + ungrouped + private)
 */
const allAgents = (s: HomeStore): SidebarAgentItem[] => {
  const groupedAgents = s.agentGroups.flatMap((g) => g.items);
  const privateGroupedAgents = s.privateAgentGroups.flatMap((g) => g.items);
  return [
    ...s.pinnedAgents,
    ...groupedAgents,
    ...s.ungroupedAgents,
    ...s.privatePinnedAgents,
    ...privateGroupedAgents,
    ...s.privateUngroupedAgents,
  ].map((item) => applyOptimisticPatch(item, s));
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
  hasPrivateAgents,
  isAgentListInit,
  pinnedAgents,
  privateAgentGroups,
  privatePinnedAgents,
  privateUngroupedAgents,
  privateUngroupedAgentsCount,
  privateUngroupedAgentsLimited,
  ungroupedAgents,
  ungroupedAgentsCount,
  ungroupedAgentsLimited,
};
