import { ActionIcon, Dropdown } from '@lobehub/ui';
import { MoreHorizontal } from 'lucide-react';
import { memo } from 'react';

import { useCronJobDropdownMenu } from './useDropdownMenu';

interface ActionsProps {
  cronJobId: string;
  topics: Array<{ id: string }>;
}

const Actions = memo<ActionsProps>(({ cronJobId, topics }) => {
  const dropdownMenu = useCronJobDropdownMenu(cronJobId, topics);

  return (
    <Dropdown
      arrow={false}
      menu={{
        items: dropdownMenu,
        onClick: ({ domEvent }) => {
          domEvent.stopPropagation();
        },
      }}
      trigger={['click']}
    >
      <ActionIcon icon={MoreHorizontal} size={'small'} />
    </Dropdown>
  );
});

export default Actions;
