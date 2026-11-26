'use client';

import type { SidebarVisibility } from '@lobechat/types';
import { type DropdownItem, Icon, toast } from '@lobehub/ui';
import { Pin, PinOff, Star, StarOff } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

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
 * Workspace entries for an Agent / chat group row menu (sidebar and Agents
 * page):
 *
 * - "Pin" / "Unpin" — the member's own pin list, available to every role and
 *   on every row.
 * - "Add to recommended agents" / "Remove from recommended agents" — the
 *   workspace's recommended list every member sees on the Agents page and new
 *   members start with in their sidebar (unpinned). It never changes a member
 *   already set up. Owner/admin only (`manage_settings`, mirrored by the
 *   server's `agent:update:all` check) and never on private rows, which
 *   nobody else can see.
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
  const { isMyPinned, isPrivate, isWorkspace } = useSidebarPinState({ id, pinned, visibility });
  const { allowed: canManageRecommended } = usePermission('manage_settings');
  const [pinItemForMe, updateRecommendedAgents] = useHomeStore((s) => [
    s.pinItemForMe,
    s.updateRecommendedAgents,
  ]);
  const recommendedIds = useHomeStore(homeAgentListSelectors.recommendedAgentIds);
  const isRecommended = recommendedIds.includes(id);

  const menuItems = useMemo<DropdownItem[]>(() => {
    if (!isWorkspace) return [];

    const items: DropdownItem[] = [
      {
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
      } as DropdownItem,
    ];

    if (canManageRecommended && !isPrivate) {
      items.push({
        icon: <Icon icon={isRecommended ? StarOff : Star} />,
        key: 'recommend',
        label: t(isRecommended ? 'unrecommendAgent' : 'recommendAgent'),
        onClick: async () => {
          try {
            await updateRecommendedAgents(
              isRecommended
                ? recommendedIds.filter((itemId) => itemId !== id)
                : [...recommendedIds, id],
            );
            toast.success(t(isRecommended ? 'unrecommendAgentSuccess' : 'recommendAgentSuccess'));
          } catch (error) {
            console.error('Failed to update recommended agents:', error);
            toast.error(
              t(isForbidden(error) ? 'recommendAgentForbidden' : 'operationFailed', {
                ns: isForbidden(error) ? 'chat' : 'common',
              }),
            );
          }
        },
      } as DropdownItem);
    }

    return items;
  }, [
    canManageRecommended,
    id,
    isMyPinned,
    isPrivate,
    isRecommended,
    isWorkspace,
    pinItemForMe,
    pinned,
    recommendedIds,
    t,
    type,
    updateRecommendedAgents,
    visibility,
  ]);

  return { menuItems };
};
