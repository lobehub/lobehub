import { ActionIcon, Dropdown } from '@lobehub/ui';
import { MoreHorizontal } from 'lucide-react';
import { memo } from 'react';

import { useTopicActionsDropdownMenu } from './useDropdownMenu';

const Actions = memo(() => {
  const dropdownMenu = useTopicActionsDropdownMenu();

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
