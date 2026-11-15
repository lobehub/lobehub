import { type ChatInputActionsProps } from '@lobehub/editor/react';
import { ChatInputActions } from '@lobehub/editor/react';
import * as stylex from '@stylexjs/stylex';
import { type StyleXStyles } from '@stylexjs/stylex';
import { memo, useMemo } from 'react';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import { type ActionKey, type ActionKeys } from '../ActionBar/config';
import { actionMap } from '../ActionBar/config';
import { useChatInputResourceAccess } from '../hooks/useChatInputResourceAccess';
import { useChatInputStore } from '../store';
import { type DropdownPlacement } from './context';
import { ActionBarContext, useActionBarContext } from './context';
import { filterChatOnlyActions } from './filterChatOnlyActions';

const mapActionToItem = (actionKey: ActionKey) => {
  const Render = actionMap[actionKey];

  return {
    alwaysDisplay: actionKey === 'contextWindow',
    children: <Render key={actionKey} />,
    key: actionKey,
  };
};

const mapActionsToItems = (
  keys: ActionKeys[],
  { disableCollapse = false }: { disableCollapse?: boolean } = {},
): ChatInputActionsProps['items'] =>
  keys.flatMap((actionKey, index) => {
    if (typeof actionKey === 'string') {
      if (actionKey === '---') {
        return {
          key: `divider-${index}`,
          type: 'divider',
        };
      }

      return mapActionToItem(actionKey);
    }

    if (disableCollapse) return actionKey.map(mapActionToItem);

    return {
      children: actionKey.map((groupActionKey) => mapActionToItem(groupActionKey)),
      key: `group-${index}`,
      type: 'collapse',
    };
  });

export interface ActionToolbarProps {
  borderRadius?: number;
  disableCollapse?: boolean;
  dropdownPlacement?: DropdownPlacement;
  extraActionItems?: ChatInputActionsProps['items'];
}

interface ActionToolbarComponentProps extends ActionToolbarProps {
  xstyle?: StyleXStyles;
}

const ActionToolbar = memo<ActionToolbarComponentProps>(
  ({ borderRadius, disableCollapse = false, dropdownPlacement, extraActionItems = [], xstyle }) => {
    const [expandInputActionbar, toggleExpandInputActionbar] = useGlobalStore((s) => [
      systemStatusSelectors.expandInputActionbar(s),
      s.toggleExpandInputActionbar,
    ]);
    const { canConfigureResource, canShowControls } = useChatInputResourceAccess();

    const leftActions = useChatInputStore((s) =>
      canConfigureResource ? s.leftActions : filterChatOnlyActions(s.leftActions),
    );

    const mobile = useChatInputStore((s) => s.mobile);

    const items = useMemo(
      () => (mapActionsToItems(leftActions, { disableCollapse }) ?? []).concat(extraActionItems),
      [disableCollapse, extraActionItems, leftActions],
    );

    // Keep an outer action size (e.g. the compact composer preset) instead of
    // resetting it for the toolbar's own items.
    const { actionSize } = useActionBarContext();
    const contextValue = useMemo(
      () => ({ actionSize, borderRadius, dropdownPlacement }),
      [actionSize, borderRadius, dropdownPlacement],
    );

    if (!canShowControls) return null;

    return (
      <ActionBarContext value={contextValue}>
        <ChatInputActions
          autoCollapse={!disableCollapse}
          className={stylex.props(xstyle).className}
          collapseOffset={mobile ? 48 : 80}
          defaultGroupCollapse={!disableCollapse}
          groupCollapse={disableCollapse ? false : !expandInputActionbar}
          items={items}
          style={{ paddingLeft: 6 }}
          onGroupCollapseChange={
            disableCollapse
              ? undefined
              : (v) => {
                  toggleExpandInputActionbar(!v);
                }
          }
        />
      </ActionBarContext>
    );
  },
);

export default ActionToolbar;
