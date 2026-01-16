import { ActionIcon, DropdownMenu, type MenuProps } from '@lobehub/ui';
import { MoreHorizontalIcon } from 'lucide-react';
import { memo } from 'react';

interface ActionsProps {
  dropdownMenu: MenuProps['items'];
  isLoading?: boolean;
}

const Actions = memo<ActionsProps>(({ dropdownMenu, isLoading }) => {
  return (
    <DropdownMenu items={dropdownMenu}>
      <ActionIcon
        icon={MoreHorizontalIcon}
        loading={isLoading}
        onClick={(e) => {
          e.stopPropagation();
        }}
        size={'small'}
      />
    </DropdownMenu>
  );
});

export default Actions;
