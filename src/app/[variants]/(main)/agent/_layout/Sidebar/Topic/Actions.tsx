import { ActionIcon, DropdownMenu } from '@lobehub/ui';
import { MoreHorizontal } from 'lucide-react';
import { memo } from 'react';

import { useTopicActionsDropdownMenu } from './useDropdownMenu';

const Actions = memo(() => {
  const menuItems = useTopicActionsDropdownMenu();

  return (
    <DropdownMenu items={menuItems}>
      <ActionIcon icon={MoreHorizontal} size={'small'} />
    </DropdownMenu>
  );
});

export default Actions;
