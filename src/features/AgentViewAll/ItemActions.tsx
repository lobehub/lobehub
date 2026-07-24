'use client';

import { type SidebarAgentItem } from '@lobechat/types';
import { ActionIcon, DropdownMenu, Icon, type MenuProps } from '@lobehub/ui';
import { EllipsisIcon, EyeIcon, EyeOffIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

interface ActionsDropdownProps extends Omit<ItemActionsProps, 'anchor'> {
  getMenuItems: () => MenuProps['items'];
}

/** Shared "…" trigger: adapts a sidebar item menu for the flat view-all list. */
const ActionsDropdown = memo<ActionsDropdownProps>(
  ({ getMenuItems, includeSidebarToggle, item, onToggleSidebar, sidebarHidden }) => {
    const { t } = useTranslation('common');

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

ActionsDropdown.displayName = 'ActionsDropdown';

/**
 * Agent and group menus live in separate components so only the matching
 * dropdown hook runs per row — each hook fetches resource access for its own
 * resource type, and running both would issue a wrong-type permission lookup
 * (NOT_FOUND) for every item in the list.
 */
const AgentItemActions = memo<ItemActionsProps>(({ anchor, item, ...rest }) => {
  const { t } = useTranslation('common');
  const { openCreateGroupModal } = useAgentModal();
  const { avatar, backgroundColor, id, pinned, slug, title, userId, visibility } = item;

  const customAvatar = typeof avatar === 'string' ? avatar : undefined;

  const handleOpenCreateGroupModal = useCallback(() => {
    openCreateGroupModal(id, visibility);
  }, [id, openCreateGroupModal, visibility]);

  const getAgentMenu = useAgentDropdownMenu({
    anchor,
    avatar: customAvatar,
    backgroundColor: backgroundColor || undefined,
    group: undefined,
    id,
    openCreateGroupModal: handleOpenCreateGroupModal,
    pinned: pinned ?? false,
    slug,
    title: title || t('agentViewAll.untitled'),
    userId,
    visibility,
  });

  return <ActionsDropdown getMenuItems={getAgentMenu} item={item} {...rest} />;
});

AgentItemActions.displayName = 'AgentItemActions';

const GroupItemActions = memo<ItemActionsProps>(({ anchor, item, ...rest }) => {
  const { t } = useTranslation('common');
  const { avatar, backgroundColor, description, id, pinned, title, userId } = item;

  const customAvatar = typeof avatar === 'string' ? avatar : undefined;
  const memberAvatars = Array.isArray(avatar) ? avatar : [];

  const getGroupMenu = useGroupDropdownMenu({
    anchor,
    avatar: customAvatar,
    backgroundColor: backgroundColor || undefined,
    description,
    id,
    memberAvatars,
    pinned: pinned ?? false,
    title: title || t('agentViewAll.untitled'),
    userId,
  });

  return <ActionsDropdown getMenuItems={getGroupMenu} item={item} {...rest} />;
});

GroupItemActions.displayName = 'GroupItemActions';

/**
 * The "…" dropdown on view-all cards / rows. Reuses the sidebar item menus
 * (pin / rename / duplicate / open in new window / move to group / copy to /
 * visibility / delete) so both surfaces expose the same operations with the
 * same permission gating.
 *
 * The hook-bearing menu component (whose `useResourceAccess` fetches this
 * item's permission) mounts lazily on first pointer-enter/focus — the
 * view-all page renders the entire workspace list at once, and fetching one
 * permission per row on page load would fan out N TRPC requests before the
 * user opens any menu. Pointer-enter precedes the click that opens the menu,
 * so the real menu is mounted by the time it is needed.
 */
const ItemActions = memo<ItemActionsProps>((props) => {
  const [activated, setActivated] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);
  const refocusPending = useRef(false);
  const activate = useCallback(() => setActivated(true), []);
  const activateFromFocus = useCallback(() => {
    // Swapping the focused placeholder subtree drops keyboard focus — note
    // it so the effect below can move focus onto the real trigger.
    refocusPending.current = true;
    setActivated(true);
  }, []);

  useEffect(() => {
    if (!activated || !refocusPending.current) return;
    refocusPending.current = false;
    containerRef.current?.querySelector('button')?.focus();
  }, [activated]);

  return (
    <span ref={containerRef}>
      {activated ? (
        props.item.type === 'group' ? (
          <GroupItemActions {...props} />
        ) : (
          <AgentItemActions {...props} />
        )
      ) : (
        <span onFocus={activateFromFocus} onPointerEnter={activate}>
          <ActionIcon icon={EllipsisIcon} size={'small'} />
        </span>
      )}
    </span>
  );
});

ItemActions.displayName = 'ItemActions';

export default ItemActions;
