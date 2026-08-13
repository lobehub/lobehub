'use client';

import type { SidebarAgentItem, SidebarAgentListResponse, SidebarGroup } from '@lobechat/types';

import { getCacheScope, useCacheScope } from '@/libs/swr/useCacheScope';

import { getProjectionStoreState, useProjectionStore } from '../../store';
import { selectHomeSidebar } from './selectors';

type EqualityFn<T> = (left: T, right: T) => boolean;

const EMPTY_ITEMS: SidebarAgentItem[] = [];
const EMPTY_GROUPS: SidebarGroup[] = [];

const pinnedAgents = (sidebar: SidebarAgentListResponse | undefined): SidebarAgentItem[] =>
  sidebar?.pinned ?? EMPTY_ITEMS;

const agentGroups = (sidebar: SidebarAgentListResponse | undefined): SidebarGroup[] =>
  sidebar?.groups ?? EMPTY_GROUPS;

const privateAgentGroups = (sidebar: SidebarAgentListResponse | undefined): SidebarGroup[] =>
  sidebar?.privateGroups ?? EMPTY_GROUPS;

const privatePinnedAgents = (sidebar: SidebarAgentListResponse | undefined): SidebarAgentItem[] =>
  sidebar?.privatePinned ?? EMPTY_ITEMS;

const ungroupedAgents = (sidebar: SidebarAgentListResponse | undefined): SidebarAgentItem[] =>
  sidebar?.ungrouped ?? EMPTY_ITEMS;

const privateUngroupedAgents = (
  sidebar: SidebarAgentListResponse | undefined,
): SidebarAgentItem[] => sidebar?.privateUngrouped ?? EMPTY_ITEMS;

const hasPrivateAgents = (sidebar: SidebarAgentListResponse | undefined): boolean =>
  privateAgentGroups(sidebar).length > 0 ||
  privatePinnedAgents(sidebar).length > 0 ||
  privateUngroupedAgents(sidebar).length > 0;

const ungroupedAgentsLimited =
  (pageSize: number) =>
  (sidebar: SidebarAgentListResponse | undefined): SidebarAgentItem[] =>
    ungroupedAgents(sidebar).slice(0, pageSize);

const privateUngroupedAgentsLimited =
  (pageSize: number) =>
  (sidebar: SidebarAgentListResponse | undefined): SidebarAgentItem[] =>
    privateUngroupedAgents(sidebar).slice(0, pageSize);

const ungroupedAgentsCount = (sidebar: SidebarAgentListResponse | undefined): number =>
  ungroupedAgents(sidebar).length;

const privateUngroupedAgentsCount = (sidebar: SidebarAgentListResponse | undefined): number =>
  privateUngroupedAgents(sidebar).length;

const isAgentListInit = (sidebar: SidebarAgentListResponse | undefined): boolean =>
  sidebar !== undefined;

const allAgents = (sidebar: SidebarAgentListResponse | undefined): SidebarAgentItem[] => [
  ...pinnedAgents(sidebar),
  ...agentGroups(sidebar).flatMap((group) => group.items),
  ...ungroupedAgents(sidebar),
  ...privatePinnedAgents(sidebar),
  ...privateAgentGroups(sidebar).flatMap((group) => group.items),
  ...privateUngroupedAgents(sidebar),
];

const getAgentById =
  (id: string) =>
  (sidebar: SidebarAgentListResponse | undefined): SidebarAgentItem | undefined =>
    allAgents(sidebar).find((agent) => agent.id === id);

const hasCustomAgents = (sidebar: SidebarAgentListResponse | undefined): boolean =>
  allAgents(sidebar).length > 0;

const agentCount = (sidebar: SidebarAgentListResponse | undefined): number =>
  allAgents(sidebar).length;

export const homeSidebarSelectors = {
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

/** Read the canonical sidebar outside React event and service boundaries. */
export const getHomeSidebarProjection = (): SidebarAgentListResponse | undefined => {
  const scope = getCacheScope();
  return selectHomeSidebar(getProjectionStoreState().scopes[scope]);
};

/** Subscribe directly to the canonical Home sidebar Projection. */
export const useHomeSidebarProjection = <Selected>(
  selector: (sidebar: SidebarAgentListResponse | undefined) => Selected,
  equalityFn?: EqualityFn<Selected>,
): Selected => {
  const scope = useCacheScope();

  return useProjectionStore(
    (state) => selector(selectHomeSidebar(state.scopes[scope])),
    equalityFn,
  );
};
