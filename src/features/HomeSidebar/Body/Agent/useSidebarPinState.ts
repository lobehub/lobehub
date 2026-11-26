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
   * Pinned in the member's own sidebar (`sidebarPinnedItemIds`, or a private
   * row's own column). In personal mode, the row's column.
   */
  isMyPinned: boolean;
  isPrivate: boolean;
  isWorkspace: boolean;
}

/**
 * Pure resolver behind {@link useSidebarPinState}.
 *
 * - Personal mode: the column is the user's own pin.
 * - Workspace, public row: the column is a legacy team pin and pins nothing
 *   by itself; the member's own pins live in `sidebarPinnedItemIds`. While
 *   the server is about to copy the team pins in (`previewTeamPins`), a team
 *   pin already counts as the member's, as it will.
 * - Workspace, private row: only the creator sees it, so its column is the
 *   creator's own pin — read alongside `sidebarPinnedItemIds`.
 */
export const resolveSidebarPinState = (
  { id, pinned, visibility }: SidebarPinStateInput,
  {
    isWorkspace,
    myPinnedIds,
    previewTeamPins = false,
  }: { isWorkspace: boolean; myPinnedIds: readonly string[]; previewTeamPins?: boolean },
): SidebarPinState => {
  const isPrivate = isWorkspace && visibility === 'private';
  if (!isWorkspace) return { isMyPinned: !!pinned, isPrivate, isWorkspace };

  return {
    isMyPinned: myPinnedIds.includes(id) || (!!pinned && (isPrivate || previewTeamPins)),
    isPrivate,
    isWorkspace,
  };
};

export const useSidebarPinState = (input: SidebarPinStateInput): SidebarPinState => {
  const isWorkspace = !!useActiveWorkspaceId();
  const myPinnedIds = useUserStore(workspaceUserSettingsSelectors.sidebarPinnedItemIds);
  const previewTeamPins = useUserStore(
    (s) => workspaceUserSettingsSelectors.sidebarSetupPreview(s) === 'teamPins',
  );

  return resolveSidebarPinState(input, { isWorkspace, myPinnedIds, previewTeamPins });
};
