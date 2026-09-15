import type { ActionIconGroupEvent, ActionIconGroupItemType } from '@lobehub/ui';
import { ActionIconGroup, Block } from '@lobehub/ui';
import type { ReactNode } from 'react';
import { memo, useCallback, useMemo } from 'react';

import { usePermission } from '@/hooks/usePermission';

import { type MessageActionItem, type MessageActionItemOrDivider } from '../../../types';
import { resolveSlots } from './resolveSlots';
import { type MessageActionContext, type MessageActionSlot } from './types';
import { useBuildActions } from './useBuildActions';

const VIEWER_BAR: MessageActionSlot[] = ['copy', 'comments'];

/**
 * Prepares an item for `ActionIconGroup`, which owns dispatch for the items it
 * is handed — our own `handleClick` is not part of that contract, so it is
 * stripped and re-dispatched through `onActionClick`.
 *
 * Submenu children are the exception: `ActionIconGroup` only attaches an
 * `onClick` to top-level menu items, and the underlying menu ignores any item
 * that has none. A nested child therefore has to carry its own — without this,
 * clicking a submenu entry closes the menu and does nothing at all.
 */
const stripHandleClick = (item: MessageActionItemOrDivider): ActionIconGroupItemType => {
  if ('type' in item && item.type === 'divider') return item as unknown as ActionIconGroupItemType;
  const { children, ...rest } = item as MessageActionItem;
  const baseItem = { ...rest } as MessageActionItem;
  delete (baseItem as { handleClick?: unknown }).handleClick;
  if (children) {
    return {
      ...baseItem,
      children: children.map((child) => {
        const nextChild = { ...child, onClick: () => child.handleClick?.() } as MessageActionItem;
        delete (nextChild as { handleClick?: unknown }).handleClick;
        return nextChild;
      }),
    } as ActionIconGroupItemType;
  }
  return baseItem as ActionIconGroupItemType;
};

/** Top-level items by key; submenu children carry their own dispatch. */
const buildActionsMap = (items: MessageActionItemOrDivider[]): Map<string, MessageActionItem> => {
  const map = new Map<string, MessageActionItem>();
  for (const item of items) {
    if ('key' in item && item.key) map.set(String(item.key), item as MessageActionItem);
  }
  return map;
};

interface MessageActionBarProps {
  /** Bar slots (always visible as icons) */
  bar: MessageActionSlot[];
  /** Runtime context passed to every action's builder */
  ctx: MessageActionContext;
  /** Custom control rendered first inside the shared action container */
  leading?: ReactNode;
  /** Menu slots (shown in the overflow dropdown); defaults to `bar` when omitted */
  menu?: MessageActionSlot[];
}

/**
 * Universal action bar. Resolves declarative slot keys (`'copy'`, `'edit'`,
 * `'divider'`, ...) against the registry and renders an ActionIconGroup.
 */
export const MessageActionBar = memo<MessageActionBarProps>(({ ctx, bar, leading, menu }) => {
  const built = useBuildActions(ctx);
  const { allowed: canEdit } = usePermission('edit_own_content');

  const effectiveBar = canEdit ? bar : VIEWER_BAR;
  const effectiveMenu = canEdit ? menu : undefined;
  const [barSlots, menuSlots] = useMemo(() => {
    const shouldPromoteComments =
      Boolean(built.comments) &&
      !effectiveBar.includes('comments') &&
      Boolean(effectiveMenu?.includes('comments'));

    return [
      shouldPromoteComments ? [...effectiveBar, 'comments'] : effectiveBar,
      shouldPromoteComments ? effectiveMenu?.filter((slot) => slot !== 'comments') : effectiveMenu,
    ];
  }, [built.comments, effectiveBar, effectiveMenu]);

  const barItems = useMemo(() => resolveSlots(barSlots, built), [barSlots, built]);
  const menuItems = useMemo(
    () => (menuSlots ? resolveSlots(menuSlots, built) : undefined),
    [menuSlots, built],
  );

  const items = useMemo(
    () => barItems.filter((item) => !('disabled' in item && item.disabled)).map(stripHandleClick),
    [barItems],
  );
  // An all-null menu (every slot's action opted out) must collapse to no menu —
  // ActionIconGroup renders the overflow trigger for any truthy array, even [].
  const menuStripped = useMemo(
    () => (menuItems?.length ? menuItems.map(stripHandleClick) : undefined),
    [menuItems],
  );

  const allActions = useMemo(
    () => buildActionsMap([...barItems, ...(menuItems ?? [])]),
    [barItems, menuItems],
  );

  // Submenu children dispatch themselves (see `stripHandleClick`); what reaches
  // here is always a top-level item.
  const handleAction = useCallback(
    (event: ActionIconGroupEvent) => {
      const action = allActions.get(event.key);
      action?.handleClick?.();
    },
    [allActions],
  );

  const actionGroup = (
    <ActionIconGroup items={items} menu={menuStripped} onActionClick={handleAction} />
  );

  if (!leading) return actionGroup;

  return (
    <Block horizontal align={'center'} padding={2}>
      {leading}
      <ActionIconGroup
        items={items}
        menu={menuStripped}
        padding={0}
        style={{ background: 'transparent', border: 'none', borderRadius: 0, boxShadow: 'none' }}
        variant={'borderless'}
        onActionClick={handleAction}
      />
    </Block>
  );
});

MessageActionBar.displayName = 'MessageActionBar';

export type { MessageActionContext, MessageActionSlot } from './types';
export { DIVIDER_KEY } from './types';
