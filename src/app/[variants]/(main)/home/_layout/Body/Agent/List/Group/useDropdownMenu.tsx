import type {MenuProps} from '@lobehub/ui';
import { useMemo } from 'react';

import { useCreateMenuItems, useSessionGroupMenuItems } from '../../../../hooks';

interface GroupDropdownMenuProps {
  id?: string;
  isCustomGroup?: boolean;
  isPinned?: boolean;
  openConfigGroupModal: () => void;
  toggleEditing?: (visible?: boolean) => void;
}

export const useGroupDropdownMenu = ({
  id,
  isCustomGroup,
  isPinned,
  toggleEditing,
  openConfigGroupModal,
}: GroupDropdownMenuProps): MenuProps['items'] => {
  // Session group menu items
  const { renameGroupMenuItem, configGroupMenuItem, deleteGroupMenuItem } =
    useSessionGroupMenuItems();

  // Create menu items
  const { createAgentMenuItem, createGroupChatMenuItem } = useCreateMenuItems();

  return useMemo(() => {
    const createAgentItem = createAgentMenuItem({ groupId: id, isPinned });
    const createGroupChatItem = createGroupChatMenuItem();
    const configItem = configGroupMenuItem(openConfigGroupModal);
    const renameItem = toggleEditing ? renameGroupMenuItem(toggleEditing) : null;
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
    isCustomGroup,
    id,
    isPinned,
    toggleEditing,
    createAgentMenuItem,
    createGroupChatMenuItem,
    configGroupMenuItem,
    renameGroupMenuItem,
    deleteGroupMenuItem,
    openConfigGroupModal,
  ]);
};
