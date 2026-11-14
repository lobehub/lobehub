'use client';

import type { SidebarVisibility } from '@lobechat/types';
import { type DropdownItem, Icon, toast } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { Pin, PinOff, UsersIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { usePermission } from '@/hooks/usePermission';
import { useHomeStore } from '@/store/home';
import { useUserStore } from '@/store/user';
import { workspaceUserSettingsSelectors } from '@/store/user/selectors';

interface UseFolderPinMenuItemsParams {
  id?: string;
  /** The folder's team pin (`session_groups.pinned`). */
  pinned?: boolean;
  visibility?: SidebarVisibility;
}

const isForbidden = (error: unknown) =>
  (error as { data?: { code?: string } } | undefined)?.data?.code === 'FORBIDDEN';

/**
 * Pin entries for a PUBLIC workspace folder. Public folders are shared
 * catalogue structure kept on the Agents page; pinning is how one reaches the
 * sidebar:
 *
 * - "Pin" / "Unpin" — the member's own pin (`sidebarPinnedItemIds`), any role.
 *   Offered on a team-pinned folder only to undo an earlier personal pin.
 * - "Pin for team" / "Unpin for team" — owner/admin only, mirrored by the
 *   server's `agent:update:all` check.
 *
 * Private folders always show in their creator's sidebar and personal mode has
 * its own folder list, so both get no items.
 */
export const useFolderPinMenuItems = ({ id, pinned, visibility }: UseFolderPinMenuItemsParams) => {
  const { t } = useTranslation(['chat', 'common']);
  const isWorkspace = !!useActiveWorkspaceId();
  const myPinnedIds = useUserStore(workspaceUserSettingsSelectors.sidebarPinnedItemIds, isEqual);
  const { allowed: canManageTeamPins } = usePermission('manage_settings');
  const [pinItemForMe, pinFolderForTeam] = useHomeStore((s) => [
    s.pinItemForMe,
    s.pinFolderForTeam,
  ]);

  const isPublicWorkspaceFolder = isWorkspace && !!id && visibility !== 'private';
  const isTeamPinned = isPublicWorkspaceFolder && !!pinned;
  const isMyPinned = isPublicWorkspaceFolder && myPinnedIds.includes(id!);

  const menuItems = useMemo<DropdownItem[]>(() => {
    if (!isPublicWorkspaceFolder || !id) return [];

    const items: DropdownItem[] = [];

    if (!isTeamPinned || isMyPinned) {
      items.push({
        icon: <Icon icon={isMyPinned ? PinOff : Pin} />,
        key: 'pin',
        label: t(isMyPinned ? 'pinOff' : 'pin'),
        onClick: async (info: any) => {
          info?.domEvent?.stopPropagation();
          try {
            await pinItemForMe({ id, type: 'folder', visibility: 'public' }, !isMyPinned);
          } catch (error) {
            console.error('Failed to update personal folder pin:', error);
            toast.error(t('operationFailed', { ns: 'common' }));
          }
        },
      } as DropdownItem);
    }

    if (canManageTeamPins) {
      items.push({
        icon: <Icon icon={isTeamPinned ? PinOff : UsersIcon} />,
        key: 'pinForTeam',
        label: t(isTeamPinned ? 'unpinForTeam' : 'pinForTeam'),
        onClick: async (info: any) => {
          info?.domEvent?.stopPropagation();
          try {
            await pinFolderForTeam(id, !isTeamPinned);
          } catch (error) {
            console.error('Failed to update folder team pin:', error);
            toast.error(
              t(isForbidden(error) ? 'pinForTeamForbidden' : 'operationFailed', {
                ns: isForbidden(error) ? 'chat' : 'common',
              }),
            );
          }
        },
      } as DropdownItem);
    }

    return items;
  }, [
    canManageTeamPins,
    id,
    isMyPinned,
    isPublicWorkspaceFolder,
    isTeamPinned,
    pinFolderForTeam,
    pinItemForMe,
    t,
  ]);

  return { isMyPinned, isPublicWorkspaceFolder, isTeamPinned, menuItems };
};
