'use client';

import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import type { SidebarAgentItem } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { useCallback, useMemo } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useUserStore } from '@/store/user';
import { userProfileSelectors, workspaceUserSettingsSelectors } from '@/store/user/selectors';

const BUILTIN_SLUGS = new Set<string>(Object.values(BUILTIN_AGENT_SLUGS));
const EMPTY_VISIBILITY_OVERRIDES: Record<string, boolean> = {};

type SidebarVisibilityItem = Pick<SidebarAgentItem, 'id' | 'slug' | 'type' | 'userId'>;

interface ResolveSidebarItemVisibilityOptions {
  currentUserId?: string;
  hiddenItemIds: ReadonlySet<string>;
  isWorkspaceMode: boolean;
  visibilityOverrides: Readonly<Record<string, boolean>>;
}

export const resolveSidebarItemVisibility = (
  item: SidebarVisibilityItem,
  {
    currentUserId,
    hiddenItemIds,
    isWorkspaceMode,
    visibilityOverrides,
  }: ResolveSidebarItemVisibilityOptions,
) => {
  const override = visibilityOverrides[item.id];
  if (override !== undefined) return override;
  if (hiddenItemIds.has(item.id)) return false;

  if (!isWorkspaceMode || item.type !== 'agent') return true;
  if (item.slug && BUILTIN_SLUGS.has(item.slug)) return true;

  // Keep the pre-profile frame stable while the current user is loading.
  // Once resolved, shared Agents created by another member default hidden.
  if (!currentUserId) return true;
  return item.userId === currentUserId;
};

/**
 * Resolves and persists the caller's sidebar membership without mutating the
 * shared Agent / chat-group row. Workspace writes are explicit per-item
 * overrides; personal mode keeps the legacy hidden-id preference.
 */
export const useSidebarItemVisibility = () => {
  const activeWorkspaceId = useActiveWorkspaceId();
  const currentUserId = useUserStore(userProfileSelectors.userId);
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
        currentUserId,
        hiddenItemIds: hiddenItemIdSet,
        isWorkspaceMode: Boolean(activeWorkspaceId),
        visibilityOverrides,
      }),
    [activeWorkspaceId, currentUserId, hiddenItemIdSet, visibilityOverrides],
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
