'use client';

import type { SidebarVisibility } from '@lobechat/types';
import { type DropdownItem, Icon, toast } from '@lobehub/ui';
import { Pin, PinOff, UsersIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { useHomeStore } from '@/store/home';

import { useSidebarPinState } from './useSidebarPinState';

interface UseSidebarPinMenuItemsParams {
  id: string;
  /** The row's own `pinned` column. */
  pinned: boolean;
  type: 'agent' | 'group';
  visibility?: SidebarVisibility;
}

const isForbidden = (error: unknown) =>
  (error as { data?: { code?: string } } | undefined)?.data?.code === 'FORBIDDEN';

/**
 * Workspace pin entries for an Agent / chat group row menu:
 *
 * - "Pin" / "Unpin" — the member's own pin, available to every role. Offered
 *   on a team-pinned row only to undo an earlier personal pin, since the team
 *   section already keeps it on top.
 * - "Pin for team" / "Unpin for team" — writes the shared column every member
 *   sees. Owner/admin only (`manage_settings`, mirrored by the server's
 *   `agent:update:all` check) and never on private rows, which nobody else
 *   can see.
 *
 * Returns no items outside a workspace; personal mode keeps its own pin.
 */
export const useSidebarPinMenuItems = ({
  id,
  pinned,
  type,
  visibility,
}: UseSidebarPinMenuItemsParams) => {
  const { t } = useTranslation(['chat', 'common']);
  const { isMyPinned, isPrivate, isTeamPinned, isWorkspace } = useSidebarPinState({
    id,
    pinned,
    visibility,
  });
  const { allowed: canManageTeamPins } = usePermission('manage_settings');
  const [pinItemForMe, pinAgent, pinAgentGroup] = useHomeStore((s) => [
    s.pinItemForMe,
    s.pinAgent,
    s.pinAgentGroup,
  ]);

  const menuItems = useMemo<DropdownItem[]>(() => {
    if (!isWorkspace) return [];

    const items: DropdownItem[] = [];

    if (!isTeamPinned || isMyPinned) {
      items.push({
        icon: <Icon icon={isMyPinned ? PinOff : Pin} />,
        key: 'pin',
        label: t(isMyPinned ? 'pinOff' : 'pin'),
        onClick: async () => {
          try {
            await pinItemForMe({ id, pinned, type, visibility }, !isMyPinned);
          } catch (error) {
            console.error('Failed to update personal pin:', error);
            toast.error(t('operationFailed', { ns: 'common' }));
          }
        },
      } as DropdownItem);
    }

    if (canManageTeamPins && !isPrivate) {
      items.push({
        icon: <Icon icon={isTeamPinned ? PinOff : UsersIcon} />,
        key: 'pinForTeam',
        label: t(isTeamPinned ? 'unpinForTeam' : 'pinForTeam'),
        onClick: async () => {
          try {
            await (type === 'group' ? pinAgentGroup : pinAgent)(id, !isTeamPinned);
          } catch (error) {
            console.error('Failed to update team pin:', error);
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
    isPrivate,
    isTeamPinned,
    isWorkspace,
    pinAgent,
    pinAgentGroup,
    pinItemForMe,
    pinned,
    t,
    type,
    visibility,
  ]);

  return { isMyPinned, isTeamPinned, menuItems };
};
