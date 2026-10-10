import type { DropdownItem } from '@lobehub/ui';
import { ActionIcon,DropdownMenu, Flexbox  } from '@lobehub/ui';
import { MoreHorizontalIcon, PlusIcon } from 'lucide-react';
import { memo } from 'react';

interface ActionsProps {
  addMenuItems: DropdownItem[];
  dropdownMenu: DropdownItem[];
  isLoading?: boolean;
}

const Actions = memo<ActionsProps>(({ dropdownMenu, addMenuItems, isLoading }) => {
  return (
    <Flexbox horizontal gap={2}>
      <DropdownMenu items={dropdownMenu}>
        <ActionIcon icon={MoreHorizontalIcon} size={'small'} style={{ flex: 'none' }} />
      </DropdownMenu>
      <DropdownMenu items={addMenuItems}>
        <ActionIcon icon={PlusIcon} loading={isLoading} size={'small'} style={{ flex: 'none' }} />
      </DropdownMenu>
    </Flexbox>
  );
});

export default Actions;
