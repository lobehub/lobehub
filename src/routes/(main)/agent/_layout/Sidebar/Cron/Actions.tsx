import { ActionIcon, DropdownMenu } from '@lobehub/ui';
import { MoreHorizontal } from 'lucide-react';
import { memo } from 'react';

import { useCronJobDropdownMenu } from './useDropdownMenu';

interface ActionsProps {
  cronJobId: string;
  topics: Array<{ id: string }>;
}

const Actions = memo<ActionsProps>(({ cronJobId, topics }) => {
  const menuItems = useCronJobDropdownMenu(cronJobId, topics);

  return (
    <DropdownMenu items={menuItems}>
      <ActionIcon icon={MoreHorizontal} size={'small'} />
    </DropdownMenu>
  );
});

export default Actions;
