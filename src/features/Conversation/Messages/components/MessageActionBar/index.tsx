import type { ActionIconGroupEvent, ActionIconGroupItemType } from '@lobehub/ui';
import { ActionIconGroup, Block } from '@lobehub/ui';
import type { ReactNode } from 'react';
import { memo, useCallback, useMemo } from 'react';

import { usePermission } from '@/hooks/usePermission';

import { type MessageActionItem, type MessageActionItemOrDivider } from '../../../types';
import { DIVIDER_KEY, type MessageActionContext, type MessageActionSlot } from './types';
import { useBuildActions } from './useBuildActions';

const DIVIDER: MessageActionItemOrDivider = { type: 'divider' };
const VIEWER_BAR: MessageActionSlot[] = ['copy'];

const stripHandleClick = (item: MessageActionItemOrDivider): ActionIconGroupItemType => {
  if ('type' in item && item.type === 'divider') return item as unknown as ActionIconGroupItemType;
  const { children, ...rest } = item as MessageActionItem;
  const baseItem = { ...rest } as MessageActionItem;
  delete (baseItem as { handleClick?: unknown }).handleClick;
  if (children) {
    return {
      ...baseItem,
      children: children.map((child) => {
        const nextChild = { ...child } as MessageActionItem;
        delete (nextChild as { handleClick?: unknown }).handleClick;
        return nextChild;
      }),
    } as ActionIconGroupItemType;
  }
  return baseItem as ActionIconGroupItemType;
};

const buildActionsMap = (items: MessageActionItemOrDivider[]): Map<string, MessageActionItem> => {
  const map = new Map<string, MessageActionItem>();
  for (const item of items) {
    if ('key' in item && item.key) {
      map.set(String(item.key), item as MessageActionItem);
      if ('children' in item && item.children) {
        for (const child of item.children) {
          if (child.key) {
            map.set(`${item.key}.${child.key}`, child as unknown as MessageActionItem);
          }
        }
      }
    }
  }
  return map;
};

const resolveSlots = (
  slots: MessageActionSlot[],
  built: Record<string, MessageActionItem | null>,
): MessageActionItemOrDivider[] => {
  const out: MessageActionItemOrDivider[] = [];
  for (const slot of slots) {
    if (slot === DIVIDER_KEY) {
      out.push(DIVIDER);
      continue;
    }
    const item = built[slot];
    if (item) out.push(item);
  }
  return out;
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

  const barItems = useMemo(() => resolveSlots(effectiveBar, built), [effectiveBar, built]);
  const menuItems = useMemo(
    () => (effectiveMenu ? resolveSlots(effectiveMenu, built) : undefined),
    [effectiveMenu, built],
  );

  const items = useMemo(
    () => barItems.filter((item) => !('disabled' in item && item.disabled)).map(stripHandleClick),
    [barItems],
  );
  const menuStripped = useMemo(() => menuItems?.map(stripHandleClick), [menuItems]);

  const allActions = useMemo(
    () => buildActionsMap([...barItems, ...(menuItems ?? [])]),
    [barItems, menuItems],
  );

  const handleAction = useCallback(
    (event: ActionIconGroupEvent) => {
      if (event.keyPath && event.keyPath.length > 1) {
        const parentKey = event.keyPath.at(-1);
        const childKey = event.keyPath[0];
        const parent = allActions.get(parentKey!);
        if (parent && 'children' in parent && parent.children) {
          const child = parent.children.find((c) => c.key === childKey);
          child?.handleClick?.();
          return;
        }
      }
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
