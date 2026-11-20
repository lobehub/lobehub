import { type DropdownItem } from '@lobehub/ui';
import { ActionIcon, DropdownMenu } from '@lobehub/ui';
import { MoreHorizontalIcon } from 'lucide-react';
import { memo } from 'react';

interface ActionsProps {
  dropdownMenu: DropdownItem[] | (() => DropdownItem[]);
}

const Actions = memo<ActionsProps>(({ dropdownMenu }) => {
  if (!dropdownMenu || (typeof dropdownMenu !== 'function' && dropdownMenu.length === 0))
    return null;

  return (
    <DropdownMenu items={dropdownMenu}>
      <ActionIcon icon={MoreHorizontalIcon} size={'small'} />
    </DropdownMenu>
  );
});

export default Actions;
