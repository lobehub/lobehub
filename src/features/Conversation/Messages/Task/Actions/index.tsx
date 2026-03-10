import { type UIChatMessage } from '@lobechat/types';
import { type ActionIconGroupEvent, type ActionIconGroupItemType } from '@lobehub/ui';
import { ActionIconGroup, createRawModal } from '@lobehub/ui';
import { memo, useCallback, useMemo } from 'react';

import { useEventCallback } from '@/hooks/useEventCallback';

import { type ShareModalProps } from '../../../components/ShareMessageModal';
import ShareMessageModal from '../../../components/ShareMessageModal';
import { createStore, Provider, useConversationStoreApi } from '../../../store';
import {
  type MessageActionItem,
  type MessageActionItemOrDivider,
  type MessageActionsConfig,
} from '../../../types';
import { ErrorActionsBar } from './Error';
import { useAssistantActions } from './useAssistantActions';

// Helper to strip handleClick from action items before passing to ActionIconGroup
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

// Build action items map for handleAction lookup
const buildActionsMap = (items: MessageActionItemOrDivider[]): Map<string, MessageActionItem> => {
  const map = new Map<string, MessageActionItem>();
  for (const item of items) {
    if ('key' in item && item.key) {
      map.set(String(item.key), item as MessageActionItem);
      // Also index children for submenu items
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

interface AssistantActionsBarProps {
  actionsConfig?: MessageActionsConfig;
  data: UIChatMessage;
  id: string;
  index: number;
}

export const AssistantActionsBar = memo<AssistantActionsBarProps>(
  ({ actionsConfig, id, data, index }) => {
    const { error, tools } = data;
    const store = useConversationStoreApi();
    const handleOpenShareModal = useEventCallback(() => {
      createRawModal(
        (props: ShareModalProps) => (
          <Provider
            createStore={() => {
              const state = store.getState();
              return createStore({
                context: state.context,
                hooks: state.hooks,
                skipFetch: state.skipFetch,
              });
            }}
          >
            <ShareMessageModal {...props} />
          </Provider>
        ),
        {
          message: data,
        },
        { onCloseKey: 'onCancel', openKey: 'open' },
      );
    });

    const defaultActions = useAssistantActions({
      data,
      id,
      index,
      onOpenShareModal: handleOpenShareModal,
    });

    const hasTools = !!tools;

    // Get collapse/expand action based on current state
    const collapseAction = defaultActions.collapse;

    // Create extra actions from factory functions
    const extraBarItems = useMemo(() => {
      if (!actionsConfig?.extraBarActions) return [];
      return actionsConfig.extraBarActions
        .map((factory) => factory(id))
        .filter((item): item is NonNullable<typeof item> => item !== null);
    }, [actionsConfig?.extraBarActions, id]);

    const extraMenuItems = useMemo(() => {
      if (!actionsConfig?.extraMenuActions) return [];
      return actionsConfig.extraMenuActions
        .map((factory) => factory(id))
        .filter((item): item is NonNullable<typeof item> => item !== null);
    }, [actionsConfig?.extraMenuActions, id]);

    // Use external config if provided, otherwise use defaults
    // Append extra actions from factories
    const barItems = useMemo(() => {
      const base =
        actionsConfig?.bar ??
        (hasTools ? [defaultActions.copy] : [defaultActions.edit, defaultActions.copy]);
      return [...base, ...extraBarItems];
    }, [actionsConfig?.bar, hasTools, defaultActions.copy, defaultActions.edit, extraBarItems]);

    const menuItems = useMemo(() => {
      const base = actionsConfig?.menu ?? [
        defaultActions.edit,
        defaultActions.copy,
        collapseAction,
        defaultActions.divider,
        defaultActions.share,
        defaultActions.divider,
        defaultActions.regenerate,
        defaultActions.del,
      ];
      return [...base, ...extraMenuItems];
    }, [
      actionsConfig?.menu,
      defaultActions.edit,
      defaultActions.copy,
      collapseAction,
      defaultActions.divider,
      defaultActions.share,
      defaultActions.regenerate,
      defaultActions.del,
      extraMenuItems,
    ]);

    // Strip handleClick for DOM safety
    const items = useMemo(
      () =>
        barItems
          .filter((item) => item && !('disabled' in item && item.disabled))
          .map(stripHandleClick),
      [barItems],
    );
    const menu = useMemo(() => menuItems.map(stripHandleClick), [menuItems]);

    // Build actions map for click handling
    const allActions = useMemo(
      () => buildActionsMap([...barItems, ...menuItems]),
      [barItems, menuItems],
    );

    const handleAction = useCallback(
      (event: ActionIconGroupEvent) => {
        // Handle submenu items (e.g., translate -> zh-CN)
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

        // Handle regular actions
        const action = allActions.get(event.key);
        action?.handleClick?.();
      },
      [allActions],
    );

    if (error) return <ErrorActionsBar actions={defaultActions} onActionClick={handleAction} />;

    return <ActionIconGroup items={items} menu={menu} onActionClick={handleAction} />;
  },
);

AssistantActionsBar.displayName = 'AssistantActionsBar';
