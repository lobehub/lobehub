import { type DropdownItem } from '@lobehub/ui';
import { ActionIcon,DropdownMenu  } from '@lobehub/ui';
import { MoreHorizontalIcon } from 'lucide-react';
import { memo } from 'react';

interface ActionsProps {
  dropdownMenu: DropdownItem[];
}

const Actions = memo<ActionsProps>(({ dropdownMenu }) => {
  return (
    <DropdownMenu items={dropdownMenu}>
      <ActionIcon icon={MoreHorizontalIcon} size={'small'} style={{ flex: 'none' }} />
    </DropdownMenu>
  );
});

export default Actions;
