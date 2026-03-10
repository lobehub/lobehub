import { type MenuProps } from '@lobehub/ui';
import { ActionIcon, DropdownMenu } from '@lobehub/ui';
import { MoreHorizontalIcon } from 'lucide-react';
import { memo } from 'react';

interface ActionsProps {
  dropdownMenu: MenuProps['items'];
}

const Actions = memo<ActionsProps>(({ dropdownMenu }) => {
  const menuItems = dropdownMenu ?? [];

  if (menuItems.length === 0) return null;

  return (
    <DropdownMenu items={menuItems}>
      <ActionIcon icon={MoreHorizontalIcon} size={'small'} />
    </DropdownMenu>
  );
});

export default Actions;
