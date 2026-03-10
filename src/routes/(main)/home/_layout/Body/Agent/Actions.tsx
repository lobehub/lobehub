import type { MenuProps } from '@lobehub/ui';
import { ActionIcon, DropdownMenu } from '@lobehub/ui';
import { MoreHorizontalIcon } from 'lucide-react';
import { memo } from 'react';

interface ActionsProps {
  dropdownMenu: MenuProps['items'];
  isLoading?: boolean;
}

const Actions = memo<ActionsProps>(({ dropdownMenu, isLoading }) => {
  return (
    <DropdownMenu items={dropdownMenu} nativeButton={false}>
      <ActionIcon
        icon={MoreHorizontalIcon}
        loading={isLoading}
        size={'small'}
        style={{ flex: 'none' }}
      />
    </DropdownMenu>
  );
});

export default Actions;
