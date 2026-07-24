'use client';

import isEqual from 'fast-deep-equal';
import { useMemo } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';
import { useUserStore } from '@/store/user';
import { workspaceUserSettingsSelectors } from '@/store/user/selectors';

/**
 * Filter predicate over the caller's "removed from my sidebar" list —
 * workspace mode reads the per-member `workspace_user_settings` bucket,
 * personal mode reads `users.preference`. Applied at sidebar render — not in
 * the home store — so "view all" surfaces (AllAgentsDrawer, the /agents page)
 * still list every item.
 */
export const useKeepSidebarListed = () => {
  const activeWorkspaceId = useActiveWorkspaceId();
  const sidebarHiddenAgentIds = useUserStore(
    (s) =>
      activeWorkspaceId
        ? workspaceUserSettingsSelectors.sidebarHiddenAgentIds(s)
        : (s.preference.sidebarHiddenAgentIds ?? []),
    isEqual,
  );

  return useMemo(() => {
    const hidden = new Set(sidebarHiddenAgentIds);
    return <T extends { id: string }>(items: T[]) =>
      hidden.size === 0 ? items : items.filter((item) => !hidden.has(item.id));
  }, [sidebarHiddenAgentIds]);
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
