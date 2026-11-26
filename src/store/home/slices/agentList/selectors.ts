import { INBOX_SESSION_ID } from '@lobechat/const';

import { type SidebarAgentItem, type SidebarGroup } from '@/database/repositories/home';
import { type HomeStore } from '@/store/home/store';

import { AGENT_LIST_KEY } from './projection';

/**
 * Get all pinned agents
 */
const pinnedAgents = (s: HomeStore): SidebarAgentItem[] => s.pinnedAgents;

/**
 * Ids of the Agents / chat groups recommended to every workspace member, in
 * the owners'/admins' order. Empty in personal mode.
 */
const EMPTY_IDS: string[] = [];
const recommendedAgentIds = (s: HomeStore): string[] => s.recommendedAgentIds ?? EMPTY_IDS;

/**
 * Get all agent groups (folders)
 */
const agentGroups = (s: HomeStore): SidebarGroup[] => s.agentGroups;

/**
 * Get private agent groups (folders) owned by the current user.
 * Empty array in personal mode.
 */
const privateAgentGroups = (s: HomeStore): SidebarGroup[] => s.privateAgentGroups;

/**
 * Get pinned private agents owned by the current user.
 * Empty array in personal mode.
 */
const privatePinnedAgents = (s: HomeStore): SidebarAgentItem[] => s.privatePinnedAgents;

/**
 * Get all ungrouped agents
 */
const ungroupedAgents = (s: HomeStore): SidebarAgentItem[] => s.ungroupedAgents;

/**
 * Get ungrouped private agents owned by the current user.
 * Empty array in personal mode.
 */
const privateUngroupedAgents = (s: HomeStore): SidebarAgentItem[] => s.privateUngroupedAgents;

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
    s.ungroupedAgents.slice(0, pageSize);

/**
 * Limit private ungrouped agents for the Private sidebar bucket
 */
const privateUngroupedAgentsLimited =
  (pageSize: number) =>
  (s: HomeStore): SidebarAgentItem[] =>
    s.privateUngroupedAgents.slice(0, pageSize);

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

/** The server confirmed the list in this session (not only the persisted copy). */
const isAgentListConfirmed = (s: HomeStore): boolean =>
  s.isAgentListInit && s.agentListReplica.entries[AGENT_LIST_KEY]?.source === 'server';

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
  ];
};

/**
 * Whether the loaded list carries Lobe AI (the inbox). It can be missing from a
 * list cached before the server started returning it, or one fetched before
 * the inbox row was first created.
 */
const hasInboxAgent = (s: HomeStore): boolean =>
  allAgents(s).some((item) => item.slug === INBOX_SESSION_ID);

/**
 * Agents every workspace member can see: the sidebar list without the
 * current user's private bucket.
 */
const sharedAgents = (s: HomeStore): SidebarAgentItem[] => [
  ...s.pinnedAgents,
  ...s.agentGroups.flatMap((g) => g.items),
  ...s.ungroupedAgents,
];

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
  hasInboxAgent,
  hasPrivateAgents,
  isAgentListConfirmed,
  isAgentListInit,
  pinnedAgents,
  privateAgentGroups,
  privatePinnedAgents,
  privateUngroupedAgents,
  privateUngroupedAgentsCount,
  privateUngroupedAgentsLimited,
  recommendedAgentIds,
  sharedAgents,
  ungroupedAgents,
  ungroupedAgentsCount,
  ungroupedAgentsLimited,
};
