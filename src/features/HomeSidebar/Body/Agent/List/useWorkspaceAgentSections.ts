'use client';

import isEqual from 'fast-deep-equal';
import { useMemo } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';
import { useUserStore } from '@/store/user';
import { userProfileSelectors, workspaceUserSettingsSelectors } from '@/store/user/selectors';

import { useKeepSidebarGroupsListed, useKeepSidebarListed } from './useAgentList';
import {
  resolveWorkspaceAgentSections,
  type WorkspaceAgentSections,
} from './workspaceAgentSections';

/**
 * The merged workspace Agents section as the member's sidebar shows it, with
 * their explicit hides applied to every section. The rest is not
 * truncated to the page size. Shared by the sidebar and the Agents page, so
 * "is this in my sidebar" has a single answer.
 */
export const useWorkspaceAgentSections = (): WorkspaceAgentSections => {
  const pinned = useHomeStore(homeAgentListSelectors.pinnedAgents, isEqual);
  const privatePinned = useHomeStore(homeAgentListSelectors.privatePinnedAgents, isEqual);
  const groups = useHomeStore(homeAgentListSelectors.agentGroups, isEqual);
  const privateGroups = useHomeStore(homeAgentListSelectors.privateAgentGroups, isEqual);
  const ungrouped = useHomeStore(homeAgentListSelectors.ungroupedAgents, isEqual);
  const privateUngrouped = useHomeStore(homeAgentListSelectors.privateUngroupedAgents, isEqual);
  const myPinnedIds = useUserStore(workspaceUserSettingsSelectors.sidebarPinnedItemIds, isEqual);
  const setupPreview = useUserStore(workspaceUserSettingsSelectors.sidebarSetupPreview);
  const recommendedIds = useHomeStore(homeAgentListSelectors.recommendedAgentIds, isEqual);
  const visibilityOverrides = useUserStore(
    workspaceUserSettingsSelectors.sidebarAgentVisibilityOverrides,
    isEqual,
  );
  const currentUserId = useUserStore(userProfileSelectors.userId);

  const keep = useKeepSidebarListed();
  const keepGroups = useKeepSidebarGroupsListed();

  return useMemo(() => {
    const resolved = resolveWorkspaceAgentSections({
      currentUserId,
      groups,
      myPinnedIds,
      pinned,
      privateGroups,
      privatePinned,
      privateUngrouped,
      recommendedIds,
      setupPreview,
      ungrouped,
      visibilityOverrides,
    });

    return {
      folders: keepGroups(resolved.folders).map((group) => ({
        ...group,
        items: keep(group.items),
      })),
      pinned: keep(resolved.pinned),
      rest: keep(resolved.rest),
    };
  }, [
    currentUserId,
    groups,
    keep,
    keepGroups,
    myPinnedIds,
    pinned,
    privateGroups,
    privatePinned,
    privateUngrouped,
    recommendedIds,
    setupPreview,
    ungrouped,
    visibilityOverrides,
  ]);
};

export interface WorkspaceSidebarItemIds {
  /** Every row the member's sidebar lists. */
  listed: ReadonlySet<string>;
}

/**
 * Ids of the Agents / chat groups listed in the member's workspace sidebar,
 * or `null` outside a workspace (personal mode keeps its own hide list).
 */
export const useWorkspaceSidebarItemIds = (): WorkspaceSidebarItemIds | null => {
  const isWorkspace = !!useActiveWorkspaceId();
  const sections = useWorkspaceAgentSections();

  return useMemo(() => {
    if (!isWorkspace) return null;

    const ids = new Set<string>();
    const add = (list: { id: string }[]) => list.forEach((item) => ids.add(item.id));
    add(sections.pinned);
    add(sections.rest);
    for (const folder of sections.folders) add(folder.items);

    return { listed: ids };
  }, [isWorkspace, sections]);
};
