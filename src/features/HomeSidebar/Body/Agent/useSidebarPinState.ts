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
  isMyPinned: boolean;
  isPrivate: boolean;
  isTeamPinned: boolean;
  isWorkspace: boolean;
}

/**
 * Pure resolver behind {@link useSidebarPinState}.
 *
 * - Personal mode: the column is the user's own pin.
 * - Workspace, public row: the column is the team pin (owner/admin managed);
 *   the member's own pin lives in `sidebarPinnedItemIds`.
 * - Workspace, private row: only the creator sees it, so its column is the
 *   creator's own pin — read alongside `sidebarPinnedItemIds`.
 */
export const resolveSidebarPinState = (
  { id, pinned, visibility }: SidebarPinStateInput,
  { isWorkspace, myPinnedIds }: { isWorkspace: boolean; myPinnedIds: readonly string[] },
): SidebarPinState => {
  const isPrivate = isWorkspace && visibility === 'private';
  if (!isWorkspace) return { isMyPinned: !!pinned, isPrivate, isTeamPinned: false, isWorkspace };

  return {
    isMyPinned: myPinnedIds.includes(id) || (isPrivate && !!pinned),
    isPrivate,
    isTeamPinned: !isPrivate && !!pinned,
    isWorkspace,
  };
};

export const useSidebarPinState = (input: SidebarPinStateInput): SidebarPinState => {
  const isWorkspace = !!useActiveWorkspaceId();
  const myPinnedIds = useUserStore(workspaceUserSettingsSelectors.sidebarPinnedItemIds);

  return resolveSidebarPinState(input, { isWorkspace, myPinnedIds });
};
