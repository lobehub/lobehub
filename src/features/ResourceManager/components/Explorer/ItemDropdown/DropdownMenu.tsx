import { ActionIcon, DropdownMenu as DropdownMenuUI } from '@lobehub/ui';
import { type ItemType } from 'antd/es/menu/interface';
import { MoreHorizontalIcon } from 'lucide-react';
import { memo } from 'react';

interface DropdownMenuProps {
  className?: string;
  items: ItemType[] | (() => ItemType[]);
}

const DropdownMenu = memo<DropdownMenuProps>(({ items, className }) => {
  return (
    <DropdownMenuUI items={items}>
      <ActionIcon className={className} icon={MoreHorizontalIcon} size={'small'} />
    </DropdownMenuUI>
  );
});

export default DropdownMenu;
