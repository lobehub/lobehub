'use client';

import isEqual from 'fast-deep-equal';
import { useMemo } from 'react';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

import { useSidebarItemVisibility } from '../useSidebarItemVisibility';

/**
 * Filter predicate over the caller's effective sidebar membership. Workspace
 * mode combines ownership defaults, legacy hidden ids, and explicit per-item
 * overrides; personal mode reads `users.preference`. Applied at render on
 * every sidebar-scoped surface (section lists AND the overflow drawer), not
 * in the home store, so `/agents` can still list every available item.
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

  return useMemo(() => {
    const filteredUngrouped = keep(ungroupedAgents);

    return {
      customList: agentGroups.map((group) => ({ ...group, items: keep(group.items) })),
      // Filter BEFORE the page-size cut so an unpin doesn't shrink the page.
      defaultList: limitDefault ? filteredUngrouped.slice(0, agentPageSize) : filteredUngrouped,
      pinnedList: keep(pinnedAgents),
      privateGroupList: privateAgentGroups.map((group) => ({
        ...group,
        items: keep(group.items),
      })),
      privateUngroupedList: keep(privateUngroupedAgents),
    };
  }, [
    agentGroups,
    agentPageSize,
    keep,
    limitDefault,
    pinnedAgents,
    ungroupedAgents,
    privateAgentGroups,
    privateUngroupedAgents,
  ]);
};
