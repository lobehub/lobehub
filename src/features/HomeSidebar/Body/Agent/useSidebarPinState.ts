'use client';

import type { SidebarVisibility } from '@lobechat/types';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useUserStore } from '@/store/user';
import { workspaceUserSettingsSelectors } from '@/store/user/selectors';

interface SidebarPinStateInput {
  id: string;
  /** The row's own `pinned` column. */
  pinned?: boolean | null;
  visibility?: SidebarVisibility | null;
}

export interface SidebarPinState {
  /**
   * Pinned in the member's own sidebar: their own pin, or a team pin they
   * did not unpin. In personal mode, the row's column.
   */
  isMyPinned: boolean;
  isPrivate: boolean;
  /** An owner/admin pinned this public row for the team (a recommendation). */
  isTeamPinned: boolean;
  isWorkspace: boolean;
}

interface SidebarPinPreference {
  isWorkspace: boolean;
  myPinnedIds: readonly string[];
  unpinnedTeamIds?: readonly string[];
}

/**
 * Pure resolver behind {@link useSidebarPinState}.
 *
 * - Personal mode: the column is the user's own pin.
 * - Workspace, public row: the column is the team pin (owner/admin managed),
 *   which counts as the member's pin until they unpin it
 *   (`sidebarUnpinnedTeamItemIds`); the member's own pins live in
 *   `sidebarPinnedItemIds`.
 * - Workspace, private row: only the creator sees it, so its column is the
 *   creator's own pin — read alongside `sidebarPinnedItemIds`.
 */
export const resolveSidebarPinState = (
  { id, pinned, visibility }: SidebarPinStateInput,
  { isWorkspace, myPinnedIds, unpinnedTeamIds = [] }: SidebarPinPreference,
): SidebarPinState => {
  const isPrivate = isWorkspace && visibility === 'private';
  if (!isWorkspace) return { isMyPinned: !!pinned, isPrivate, isTeamPinned: false, isWorkspace };

  const isTeamPinned = !isPrivate && !!pinned;

  return {
    isMyPinned:
      myPinnedIds.includes(id) ||
      (isPrivate && !!pinned) ||
      (isTeamPinned && !unpinnedTeamIds.includes(id)),
    isPrivate,
    isTeamPinned,
    isWorkspace,
  };
};

export const useSidebarPinState = (input: SidebarPinStateInput): SidebarPinState => {
  const isWorkspace = !!useActiveWorkspaceId();
  const myPinnedIds = useUserStore(workspaceUserSettingsSelectors.sidebarPinnedItemIds);
  const unpinnedTeamIds = useUserStore(workspaceUserSettingsSelectors.sidebarUnpinnedTeamItemIds);

  return resolveSidebarPinState(input, { isWorkspace, myPinnedIds, unpinnedTeamIds });
};
