'use client';

import isEqual from 'fast-deep-equal';
import { useCallback, useMemo } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useUserStore } from '@/store/user';
import { workspaceUserSettingsSelectors } from '@/store/user/selectors';

/**
 * Personal mask over the shared folder (Category) list.
 *
 * Folders themselves — which ones exist, their order, and which Agents sit in
 * them — are workspace-shared. What each member controls is whether a folder
 * shows up in *their* sidebar. Hiding one hides the whole section, its items
 * included; they stay reachable from the agents list and search.
 *
 * Unlike {@link useSidebarItemVisibility} there is no ownership default and no
 * legacy override map to reconcile, so a plain hidden-id list is enough — and
 * it reads the same way in personal mode (`users.preference`) and workspace
 * mode (`workspace_user_settings.preference`).
 */
export const useSidebarGroupVisibility = () => {
  const activeWorkspaceId = useActiveWorkspaceId();
  const hiddenGroupIds = useUserStore(
    (s) =>
      activeWorkspaceId
        ? workspaceUserSettingsSelectors.sidebarHiddenGroupIds(s)
        : (s.preference.sidebarHiddenGroupIds ?? []),
    isEqual,
  );
  const updatePreference = useUserStore((s) => s.updatePreference);
  const updateWorkspaceUserPreference = useUserStore((s) => s.updateWorkspaceUserPreference);

  const hiddenGroupIdSet = useMemo(() => new Set(hiddenGroupIds), [hiddenGroupIds]);

  const isSidebarGroupVisible = useCallback(
    (groupId: string) => !hiddenGroupIdSet.has(groupId),
    [hiddenGroupIdSet],
  );

  const setSidebarGroupVisible = useCallback(
    async (groupId: string, visible: boolean) => {
      const nextHiddenGroupIds = visible
        ? hiddenGroupIds.filter((id) => id !== groupId)
        : hiddenGroupIds.includes(groupId)
          ? hiddenGroupIds
          : [...hiddenGroupIds, groupId];

      // Nothing to persist when the list is already in the requested shape —
      // avoids a write (and a re-render round trip) on repeated toggles.
      if (nextHiddenGroupIds === hiddenGroupIds) return;

      if (activeWorkspaceId) {
        await updateWorkspaceUserPreference({ sidebarHiddenGroupIds: nextHiddenGroupIds });
        return;
      }
      await updatePreference({ sidebarHiddenGroupIds: nextHiddenGroupIds });
    },
    [activeWorkspaceId, hiddenGroupIds, updatePreference, updateWorkspaceUserPreference],
  );

  return { isSidebarGroupVisible, setSidebarGroupVisible };
};
