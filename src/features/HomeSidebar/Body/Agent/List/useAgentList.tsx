'use client';

import isEqual from 'fast-deep-equal';
import { useMemo } from 'react';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

import { useSidebarGroupVisibility } from '../useSidebarGroupVisibility';
import { useSidebarItemVisibility } from '../useSidebarItemVisibility';

/**
 * Filter predicate over the caller's effective sidebar membership: legacy
 * hidden ids plus explicit per-item overrides, read from
 * `workspace_user_settings` in workspace mode and `users.preference`
 * otherwise. Applied at render on every sidebar-scoped surface (section lists
 * AND the overflow drawer), not in the home store, so `/agents` can still list
 * every available item.
 */
export const useKeepSidebarListed = () => {
  const { isSidebarItemVisible } = useSidebarItemVisibility();

  return useMemo(
    () =>
      <T extends Parameters<typeof isSidebarItemVisible>[0]>(items: T[]) =>
        items.filter(isSidebarItemVisible),
    [isSidebarItemVisible],
  );
};

/**
 * Companion predicate for folders: drops the whole section (items included)
 * when the caller hid that Category. The folder itself stays shared — this is
 * only the caller's own view of it.
 */
export const useKeepSidebarGroupsListed = () => {
  const { isSidebarGroupVisible } = useSidebarGroupVisibility();

  return useMemo(
    () =>
      <T extends { id: string }>(groups: T[]) =>
        groups.filter((group) => isSidebarGroupVisible(group.id)),
    [isSidebarGroupVisible],
  );
};

// SWR subscription is owned by the caller of AgentListContent (Body/Agent
// accordion, or the standalone SwitchPanel). Subscribing here would re-fetch
// on every accordion expand and flash spinners across the sidebar.
export const useAgentList = (limitDefault = true) => {
  const agentPageSize = useGlobalStore(systemStatusSelectors.agentPageSize);
  const ungroupedAgents = useHomeStore(homeAgentListSelectors.ungroupedAgents, isEqual);
  const agentGroups = useHomeStore(homeAgentListSelectors.agentGroups, isEqual);
  const pinnedAgents = useHomeStore(homeAgentListSelectors.pinnedAgents, isEqual);
  const privateAgentGroups = useHomeStore(homeAgentListSelectors.privateAgentGroups, isEqual);
  const privateUngroupedAgents = useHomeStore(
    homeAgentListSelectors.privateUngroupedAgents,
    isEqual,
  );
  const keep = useKeepSidebarListed();
  const keepGroups = useKeepSidebarGroupsListed();

  return useMemo(() => {
    const filteredUngrouped = keep(ungroupedAgents);

    return {
      customList: keepGroups(agentGroups).map((group) => ({ ...group, items: keep(group.items) })),
      // Filter BEFORE the page-size cut so an unpin doesn't shrink the page.
      defaultList: limitDefault ? filteredUngrouped.slice(0, agentPageSize) : filteredUngrouped,
      pinnedList: keep(pinnedAgents),
      privateGroupList: keepGroups(privateAgentGroups).map((group) => ({
        ...group,
        items: keep(group.items),
      })),
      privateUngroupedList: keep(privateUngroupedAgents),
    };
  }, [
    agentGroups,
    agentPageSize,
    keep,
    keepGroups,
    limitDefault,
    pinnedAgents,
    ungroupedAgents,
    privateAgentGroups,
    privateUngroupedAgents,
  ]);
};
