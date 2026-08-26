import { type MenuProps } from '@lobehub/ui';
import { DropdownMenu } from '@lobehub/ui';
import { ActionIcon } from '@lobehub/ui/base-ui';
import { MoreHorizontalIcon } from 'lucide-react';
import { memo } from 'react';

interface ActionsProps {
  dropdownMenu: MenuProps['items'];
}

const Actions = memo<ActionsProps>(({ dropdownMenu }) => {
  return (
    <DropdownMenu items={dropdownMenu}>
      <ActionIcon icon={MoreHorizontalIcon} size={'small'} style={{ flex: 'none' }} />
    </DropdownMenu>
  );
});

export default Actions;
