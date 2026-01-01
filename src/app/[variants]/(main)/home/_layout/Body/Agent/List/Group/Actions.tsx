import { ActionIcon, Dropdown, type MenuProps } from '@lobehub/ui';
import { MoreHorizontalIcon } from 'lucide-react';
import { memo } from 'react';

interface ActionsProps {
  dropdownMenu: MenuProps['items'];
  isLoading?: boolean;
}

const Actions = memo<ActionsProps>(({ dropdownMenu, isLoading }) => {
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
      <ActionIcon
        icon={MoreHorizontalIcon}
        loading={isLoading}
        onClick={(e) => {
          e.stopPropagation();
        }}
        size={'small'}
      />
    </Dropdown>
  );
});

export default Actions;
