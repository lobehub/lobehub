'use client';

import type { SidebarAgentItem } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { useCallback, useMemo } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useUserStore } from '@/store/user';
import { workspaceUserSettingsSelectors } from '@/store/user/selectors';

const EMPTY_VISIBILITY_OVERRIDES: Record<string, boolean> = {};

type SidebarVisibilityItem = Pick<SidebarAgentItem, 'id' | 'slug' | 'type' | 'userId'>;

interface ResolveSidebarItemVisibilityOptions {
  hiddenItemIds: ReadonlySet<string>;
  visibilityOverrides: Readonly<Record<string, boolean>>;
}

/**
 * The workspace sidebar is a shared structure: everything the caller can see
 * is listed by default, regardless of who created it. Hiding is the caller's
 * own opt-out, recorded either as an explicit override or in the legacy
 * hidden-id list.
 */
export const resolveSidebarItemVisibility = (
  item: SidebarVisibilityItem,
  { hiddenItemIds, visibilityOverrides }: ResolveSidebarItemVisibilityOptions,
) => {
  const override = visibilityOverrides[item.id];
  if (override !== undefined) return override;

  return !hiddenItemIds.has(item.id);
};

/**
 * Resolves and persists the caller's sidebar membership without mutating the
 * shared Agent / chat-group row. Workspace writes are explicit per-item
 * overrides; personal mode keeps the legacy hidden-id preference.
 */
export const useSidebarItemVisibility = () => {
  const activeWorkspaceId = useActiveWorkspaceId();
  const hiddenItemIds = useUserStore(
    (s) =>
      activeWorkspaceId
        ? workspaceUserSettingsSelectors.sidebarHiddenAgentIds(s)
        : (s.preference.sidebarHiddenAgentIds ?? []),
    isEqual,
  );
  const visibilityOverrides = useUserStore(
    activeWorkspaceId
      ? workspaceUserSettingsSelectors.sidebarAgentVisibilityOverrides
      : () => EMPTY_VISIBILITY_OVERRIDES,
    isEqual,
  );
  const updatePreference = useUserStore((s) => s.updatePreference);
  const updateWorkspaceUserPreference = useUserStore((s) => s.updateWorkspaceUserPreference);

  const hiddenItemIdSet = useMemo(() => new Set(hiddenItemIds), [hiddenItemIds]);

  const isSidebarItemVisible = useCallback(
    (item: SidebarVisibilityItem) =>
      resolveSidebarItemVisibility(item, {
        hiddenItemIds: hiddenItemIdSet,
        visibilityOverrides,
      }),
    [hiddenItemIdSet, visibilityOverrides],
  );

  const setSidebarItemVisible = useCallback(
    async (itemId: string, visible: boolean) => {
      if (activeWorkspaceId) {
        await updateWorkspaceUserPreference({
          sidebarAgentVisibilityOverrides: { [itemId]: visible },
        });
        return;
      }

      const nextHiddenItemIds = visible
        ? hiddenItemIds.filter((id) => id !== itemId)
        : hiddenItemIds.includes(itemId)
          ? hiddenItemIds
          : [...hiddenItemIds, itemId];
      await updatePreference({ sidebarHiddenAgentIds: nextHiddenItemIds });
    },
    [activeWorkspaceId, hiddenItemIds, updatePreference, updateWorkspaceUserPreference],
  );

  return { isSidebarItemVisible, setSidebarItemVisible };
};
