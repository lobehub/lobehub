import { ActionIcon, Dropdown, type MenuProps } from '@lobehub/ui';
import { MoreHorizontalIcon } from 'lucide-react';
import { memo } from 'react';

interface ActionProps {
  dropdownMenu: MenuProps['items'];
}

const Actions = memo<ActionProps>(({ dropdownMenu }) => {
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
      <ActionIcon icon={MoreHorizontalIcon} size={'small'} />
    </Dropdown>
  );
});

export default Actions;
