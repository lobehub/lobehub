import { type ChatInputActionsProps } from '@lobehub/editor/react';
import { ChatInputActions } from '@lobehub/editor/react';
import { memo, useMemo } from 'react';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/slices/preference/selectors';

import { type ActionKeys } from '../ActionBar/config';
import { actionMap } from '../ActionBar/config';
import { useChatInputStore } from '../store';
import { type DropdownPlacement } from './context';
import { ActionBarContext } from './context';

const mapActionsToItems = (keys: ActionKeys[]): ChatInputActionsProps['items'] =>
  keys.map((actionKey, index) => {
    if (typeof actionKey === 'string') {
      if (actionKey === '---') {
        return {
          key: `divider-${index}`,
          type: 'divider',
        };
      }
      const Render = actionMap[actionKey];
      return {
        alwaysDisplay: actionKey === 'mainToken',
        children: <Render key={actionKey} />,
        key: actionKey,
      };
    } else {
      return {
        children: actionKey.map((groupActionKey) => {
          const Render = actionMap[groupActionKey];
          return {
            children: <Render key={groupActionKey} />,
            key: groupActionKey,
          };
        }),
        key: `group-${index}`,
        type: 'collapse',
      };
    }
  });

export interface ActionToolbarProps {
  dropdownPlacement?: DropdownPlacement;
  extraActionItems?: ChatInputActionsProps['items'];
}

const ActionToolbar = memo<ActionToolbarProps>(({ dropdownPlacement, extraActionItems = [] }) => {
  const [expandInputActionbar, toggleExpandInputActionbar] = useGlobalStore((s) => [
    systemStatusSelectors.expandInputActionbar(s),
    s.toggleExpandInputActionbar,
  ]);
  const enableRichRender = useUserStore(labPreferSelectors.enableInputMarkdown);

  const leftActions = useChatInputStore((s) =>
    s.leftActions.filter((item) => (enableRichRender ? true : item !== 'typo')),
  );

  const mobile = useChatInputStore((s) => s.mobile);

  const items = useMemo(
    () => (mapActionsToItems(leftActions) ?? []).concat(extraActionItems),
    [extraActionItems, leftActions],
  );

  const contextValue = useMemo(() => ({ dropdownPlacement }), [dropdownPlacement]);

  return (
    <ActionBarContext value={contextValue}>
      <ChatInputActions
        collapseOffset={mobile ? 48 : 80}
        defaultGroupCollapse={true}
        groupCollapse={!expandInputActionbar}
        items={items}
        onGroupCollapseChange={(v) => {
          toggleExpandInputActionbar(!v);
        }}
      />
    </ActionBarContext>
  );
});

export default ActionToolbar;
