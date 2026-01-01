import { type MenuProps } from '@lobehub/ui';
import { useMemo } from 'react';

import { useSessionItemMenuItems } from '../../../../hooks';

interface ActionProps {
  group: string | undefined;
  id: string;
  openCreateGroupModal: () => void;
  parentType: 'agent' | 'group';
  pinned: boolean;
  sessionType?: string;
  toggleEditing: (visible?: boolean) => void;
}

export const useDropdownMenu = ({
  group,
  id,
  openCreateGroupModal,
  parentType,
  pinned,
  sessionType,
  toggleEditing,
}: ActionProps): MenuProps['items'] => {
  const {
    pinMenuItem,
    renameMenuItem,
    duplicateMenuItem,
    openInNewWindowMenuItem,
    moveToGroupMenuItem,
    deleteMenuItem,
  } = useSessionItemMenuItems();

  return useMemo(
    () =>
      [
        pinMenuItem(id, pinned, parentType),
        renameMenuItem(toggleEditing),
        duplicateMenuItem(id),
        openInNewWindowMenuItem(id),
        { type: 'divider' },
        moveToGroupMenuItem(id, group, openCreateGroupModal),
        { type: 'divider' },
        deleteMenuItem(id, parentType, sessionType),
      ].filter(Boolean) as MenuProps['items'],
    [
      id,
      pinned,
      parentType,
      group,
      sessionType,
      pinMenuItem,
      renameMenuItem,
      duplicateMenuItem,
      openInNewWindowMenuItem,
      moveToGroupMenuItem,
      deleteMenuItem,
      openCreateGroupModal,
      toggleEditing,
    ],
  );
};
