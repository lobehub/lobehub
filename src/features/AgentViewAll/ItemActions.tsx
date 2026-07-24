'use client';

import { type SidebarAgentItem } from '@lobechat/types';
import { ActionIcon, DropdownMenu, Icon, type MenuProps } from '@lobehub/ui';
import { EllipsisIcon, EyeIcon, EyeOffIcon } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useGroupDropdownMenu } from '@/routes/(main)/home/_layout/Body/Agent/List/AgentGroupItem/useDropdownMenu';
import { useAgentDropdownMenu } from '@/routes/(main)/home/_layout/Body/Agent/List/AgentItem/useDropdownMenu';
import { useAgentModal } from '@/routes/(main)/home/_layout/Body/Agent/ModalProvider';

type MenuItems = NonNullable<MenuProps['items']>;

/** Drop leading / trailing / consecutive dividers left behind by filtering. */
const collapseDividers = (menu: MenuItems): MenuItems => {
  const result: MenuItems = [];
  for (const menuItem of menu) {
    const isDivider = !!menuItem && 'type' in menuItem && menuItem.type === 'divider';
    const lastItem = result.at(-1);
    const lastIsDivider = !!lastItem && 'type' in lastItem && lastItem.type === 'divider';
    if (isDivider && (result.length === 0 || lastIsDivider)) continue;
    result.push(menuItem);
  }
  while (result.length > 0) {
    const lastItem = result.at(-1);
    if (!!lastItem && 'type' in lastItem && lastItem.type === 'divider') result.pop();
    else break;
  }
  return result;
};

interface ItemActionsProps {
  /** Element the rename EditingPopover anchors to (the card / row root). */
  anchor: HTMLElement | null;
  /**
   * Merge the sidebar show/hide toggle in as the first menu item (card mode).
   * List mode keeps the standalone eye icon next to this menu instead.
   */
  includeSidebarToggle?: boolean;
  item: SidebarAgentItem;
  onToggleSidebar?: (item: SidebarAgentItem) => void;
  sidebarHidden?: boolean;
}

/**
 * The "…" dropdown on view-all cards / rows. Reuses the sidebar item menus
 * (pin / rename / duplicate / open in new window / move to group / copy to /
 * visibility / delete) so both surfaces expose the same operations with the
 * same permission gating.
 */
const ItemActions = memo<ItemActionsProps>(
  ({ anchor, includeSidebarToggle, item, onToggleSidebar, sidebarHidden }) => {
    const { t } = useTranslation('common');
    const { openCreateGroupModal } = useAgentModal();
    const { avatar, backgroundColor, description, id, pinned, slug, title, type, userId } = item;
    const visibility = item.visibility;

    const customAvatar = typeof avatar === 'string' ? avatar : undefined;
    const memberAvatars = Array.isArray(avatar) ? avatar : [];
    const displayTitle = title || t('agentViewAll.untitled');

    const handleOpenCreateGroupModal = useCallback(() => {
      openCreateGroupModal(id, visibility);
    }, [id, openCreateGroupModal, visibility]);

    // Both hooks run unconditionally (rules of hooks); the item type picks
    // which menu the dropdown actually renders.
    const getAgentMenu = useAgentDropdownMenu({
      anchor,
      avatar: customAvatar,
      backgroundColor: backgroundColor || undefined,
      group: undefined,
      id,
      openCreateGroupModal: handleOpenCreateGroupModal,
      pinned: pinned ?? false,
      slug,
      title: displayTitle,
      userId,
      visibility,
    });
    const getGroupMenu = useGroupDropdownMenu({
      anchor,
      avatar: customAvatar,
      backgroundColor: backgroundColor || undefined,
      description,
      id,
      memberAvatars,
      pinned: pinned ?? false,
      title: displayTitle,
      userId,
    });

    const getMenuItems = type === 'group' ? getGroupMenu : getAgentMenu;

    const items = useMemo(
      () => (): MenuProps['items'] => {
        // Pin and move-to-group organize the sidebar; they're meaningless in
        // this flat view-all list, so drop them (and any dividers left over).
        const menu = collapseDividers(
          (getMenuItems() ?? []).filter(
            (menuItem) => !menuItem || !['moveGroup', 'pin'].includes(String(menuItem.key)),
          ),
        );
        if (!includeSidebarToggle || !onToggleSidebar) return menu;
        return [
          {
            icon: <Icon icon={sidebarHidden ? EyeIcon : EyeOffIcon} />,
            key: 'sidebar',
            label: sidebarHidden
              ? t('agentViewAll.addToSidebar')
              : t('agentViewAll.removeFromSidebar'),
            onClick: ({ domEvent }: any) => {
              domEvent?.stopPropagation();
              onToggleSidebar(item);
            },
          },
          { type: 'divider' as const },
          ...menu,
        ];
      },
      [getMenuItems, includeSidebarToggle, item, onToggleSidebar, sidebarHidden, t],
    );

    return (
      <DropdownMenu items={items}>
        <ActionIcon icon={EllipsisIcon} size={'small'} />
      </DropdownMenu>
    );
  },
);

ItemActions.displayName = 'ItemActions';

export default ItemActions;
