'use client';

import isEqual from 'fast-deep-equal';
import { useMemo } from 'react';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

import { useSidebarGroupVisibility } from '../useSidebarGroupVisibility';
import { useSidebarItemVisibility } from '../useSidebarItemVisibility';
import { liftInboxRow, withoutInboxInGroups } from './inboxRow';

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
    // Filter BEFORE the page-size cut so an unpin doesn't shrink the page.
    const filteredUngrouped = keep(ungroupedAgents);
    // Cut BEFORE lifting Lobe AI out, so the page (Lobe AI included) matches the
    // "More" row's count of the whole ungrouped list.
    const pageUngrouped = limitDefault
      ? filteredUngrouped.slice(0, agentPageSize)
      : filteredUngrouped;

    // Lobe AI (the inbox) leads the sidebar wherever its row sits, so it is
    // taken out of the sections and returned on its own.
    const custom = withoutInboxInGroups(
      keepGroups(agentGroups).map((group) => ({ ...group, items: keep(group.items) })),
    );
    const privateGroups = withoutInboxInGroups(
      keepGroups(privateAgentGroups).map((group) => ({ ...group, items: keep(group.items) })),
    );
    const { inbox, lists } = liftInboxRow({
      defaultList: pageUngrouped,
      pinnedList: keep(pinnedAgents),
      privateUngroupedList: keep(privateUngroupedAgents),
    });

    return {
      customList: custom.groups,
      defaultList: lists.defaultList,
      inboxItem: inbox ?? custom.inbox ?? privateGroups.inbox,
      pinnedList: lists.pinnedList,
      privateGroupList: privateGroups.groups,
      privateUngroupedList: lists.privateUngroupedList,
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
