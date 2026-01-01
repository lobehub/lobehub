import { ActionIcon, Dropdown, type MenuProps } from '@lobehub/ui';
import { MoreHorizontalIcon } from 'lucide-react';
import { memo } from 'react';

interface ActionsProps {
  dropdownMenu: MenuProps['items'];
}

const Actions = memo<ActionsProps>(({ dropdownMenu }) => {
  if (!dropdownMenu || dropdownMenu.length === 0) return null;

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
