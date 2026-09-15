'use client';

import { agentDisplayName, type SidebarAgentItem } from '@lobechat/types';
import type { MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { ActionIcon, DropdownMenu } from '@lobehub/ui/base-ui';
import { EllipsisIcon, EyeIcon, EyeOffIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useGroupDropdownMenu } from '@/features/HomeSidebar/Body/Agent/List/AgentGroupItem/useDropdownMenu';
import { useAgentDropdownMenu } from '@/features/HomeSidebar/Body/Agent/List/AgentItem/useDropdownMenu';
import { useAgentModal } from '@/features/HomeSidebar/Body/Agent/ModalProvider';

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
   * Activate the real (hook-bearing) menu from outside — the row/card sets
   * this on its own pointer-enter so a right-click anywhere on it has the
   * menu ready, not just after hovering the "…" trigger.
   */
  forceActivated?: boolean;
  /**
   * Headless mode: mount the menu machinery (for the right-click trigger via
   * `onMenuReady`) without rendering the "…" button — the context menu is the
   * only entry.
   */
  hideTrigger?: boolean;
  /**
   * Merge the sidebar show/hide toggle in as the first menu item. Every
   * surface that can toggle sets it: cards have no other affordance, and rows
   * carry the standalone eye icon as a shortcut but still need the action
   * where users look for a row's actions — its right-click menu.
   */
  includeSidebarToggle?: boolean;
  item: SidebarAgentItem;
  /**
   * Hands the filtered menu-items getter back to the row/card, which feeds it
   * to its ContextMenuTrigger so right-click shows the same menu as "…".
   */
  onMenuReady?: (getItems: () => MenuProps['items']) => void;
  onToggleSidebar?: (item: SidebarAgentItem) => void;
  sidebarHidden?: boolean;
}

interface ActionsDropdownProps extends Omit<ItemActionsProps, 'anchor'> {
  getMenuItems: () => MenuProps['items'];
}

/** Shared "…" trigger: adapts a sidebar item menu for the flat view-all list. */
const ActionsDropdown = memo<ActionsDropdownProps>(
  ({
    getMenuItems,
    hideTrigger,
    includeSidebarToggle,
    item,
    onMenuReady,
    onToggleSidebar,
    sidebarHidden,
  }) => {
    const { t } = useTranslation('common');

    const items = useMemo(
      () => (): MenuProps['items'] => {
        // Pin and move-to-group organize the sidebar; they're meaningless in
        // this flat view-all list, so drop them (and any dividers left over).
        const menu = collapseDividers(
          (getMenuItems() ?? []).filter(
            (menuItem) =>
              !menuItem || !['hideFromSidebar', 'moveGroup', 'pin'].includes(String(menuItem.key)),
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

    // Expose the same filtered items to the row/card's right-click trigger.
    useEffect(() => {
      onMenuReady?.(items);
    }, [items, onMenuReady]);

    if (hideTrigger) return null;

    return (
      <DropdownMenu items={items}>
        <ActionIcon icon={EllipsisIcon} size={'small'} title={t('more')} />
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
  const { avatar, backgroundColor, id, pinned, slug, userId, visibility } = item;

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
    labels: item.labels,
    labelsEnabled: true,
    openCreateGroupModal: handleOpenCreateGroupModal,
    pinned: pinned ?? false,
    slug,
    title: agentDisplayName(item, t('agentViewAll.untitled')),
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
  const { t } = useTranslation('common');
  const [selfActivated, setSelfActivated] = useState(false);
  const activated = selfActivated || props.forceActivated;
  const containerRef = useRef<HTMLSpanElement>(null);
  const refocusPending = useRef(false);
  const activate = useCallback(() => setSelfActivated(true), []);
  const activateFromFocus = useCallback(() => {
    // Swapping the focused placeholder subtree drops keyboard focus — note
    // it so the effect below can move focus onto the real trigger.
    refocusPending.current = true;
    setSelfActivated(true);
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
      ) : props.hideTrigger ? null : (
        <span onFocus={activateFromFocus} onPointerEnter={activate}>
          {/* Explicit aria-label: outside a popup trigger, ActionIcon does not
              derive one from `title`, leaving the focusable placeholder
              unnamed for screen readers until the real trigger mounts. */}
          <ActionIcon aria-label={t('more')} icon={EllipsisIcon} size={'small'} title={t('more')} />
        </span>
      )}
    </span>
  );
});

ItemActions.displayName = 'ItemActions';

export default ItemActions;
