import { type MenuProps } from '@lobehub/ui';
import { useMemo } from 'react';

import { useCreateMenuItems, useSessionGroupMenuItems } from '../../../../hooks';

interface GroupDropdownMenuProps {
  anchor: HTMLElement | null;
  id?: string;
  isCustomGroup?: boolean;
  isPinned?: boolean;
  name?: string;
  openConfigGroupModal: () => void;
}

export const useGroupDropdownMenu = ({
  anchor,
  id,
  isCustomGroup,
  isPinned,
  name,
  openConfigGroupModal,
}: GroupDropdownMenuProps): MenuProps['items'] => {
  // Session group menu items
  const { renameGroupMenuItem, configGroupMenuItem, deleteGroupMenuItem } =
    useSessionGroupMenuItems();

  // Create menu items
  const { createAgentMenuItem, createGroupChatMenuItem } = useCreateMenuItems();

  return useMemo(() => {
    const createAgentItem = createAgentMenuItem({ groupId: id, isPinned });
    const createGroupChatItem = createGroupChatMenuItem({ groupId: id });
    const configItem = configGroupMenuItem(openConfigGroupModal);
    const renameItem = id && name ? renameGroupMenuItem(id, name, anchor) : null;
    const deleteItem = id ? deleteGroupMenuItem(id) : null;

    return [
      createAgentItem,
      createGroupChatItem,
      { type: 'divider' as const },
      ...(isCustomGroup
        ? [renameItem, configItem, { type: 'divider' as const }, deleteItem]
        : [configItem]),
    ].filter(Boolean) as MenuProps['items'];
  }, [
    anchor,
    isCustomGroup,
    id,
    isPinned,
    name,
    createAgentMenuItem,
    createGroupChatMenuItem,
    configGroupMenuItem,
    renameGroupMenuItem,
    deleteGroupMenuItem,
    openConfigGroupModal,
  ]);
};
