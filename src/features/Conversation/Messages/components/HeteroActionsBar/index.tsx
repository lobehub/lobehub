import type { ActionIconGroupEvent, ActionIconGroupItemType } from '@lobehub/ui';
import { ActionIconGroup } from '@lobehub/ui';
import { memo, useCallback, useMemo } from 'react';

import { type MessageActionItem, type MessageActionItemOrDivider } from '../../../types';

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
    }
  }
  return map;
};

interface HeteroActionsBarProps {
  bar: MessageActionItemOrDivider[];
  menu?: MessageActionItemOrDivider[];
}

export const HeteroActionsBar = memo<HeteroActionsBarProps>(({ bar, menu }) => {
  const items = useMemo(() => bar.map(stripHandleClick), [bar]);
  const menuItems = useMemo(() => menu?.map(stripHandleClick), [menu]);

  const allActions = useMemo(() => buildActionsMap([...bar, ...(menu ?? [])]), [bar, menu]);

  const handleAction = useCallback(
    (event: ActionIconGroupEvent) => {
      const action = allActions.get(event.key);
      action?.handleClick?.();
    },
    [allActions],
  );

  return <ActionIconGroup items={items} menu={menuItems} onActionClick={handleAction} />;
});

HeteroActionsBar.displayName = 'HeteroActionsBar';
