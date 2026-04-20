import type { MenuProps } from '@lobehub/ui';
import { ActionIcon, DropdownMenu, Flexbox } from '@lobehub/ui';
import { MoreHorizontalIcon, PlusIcon } from 'lucide-react';
import { memo } from 'react';

interface ActionsProps {
  addMenuItems: MenuProps['items'];
  dropdownMenu: MenuProps['items'];
  isLoading?: boolean;
}

const Actions = memo<ActionsProps>(({ dropdownMenu, addMenuItems, isLoading }) => {
  return (
    <Flexbox horizontal gap={2}>
      <DropdownMenu items={dropdownMenu} nativeButton={false}>
        <ActionIcon icon={MoreHorizontalIcon} size={'small'} style={{ flex: 'none' }} />
      </DropdownMenu>
      <DropdownMenu items={addMenuItems} nativeButton={false}>
        <ActionIcon icon={PlusIcon} loading={isLoading} size={'small'} style={{ flex: 'none' }} />
      </DropdownMenu>
    </Flexbox>
  );
});

export default Actions;
