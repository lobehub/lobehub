import type { ItemType } from '@lobehub/ui';
import { ActionIcon, DropdownMenu as DropdownMenuUI } from '@lobehub/ui';
import { MoreHorizontalIcon } from 'lucide-react';
import { memo } from 'react';

interface DropdownMenuProps {
  className?: string;
  /** Open on mount (the trigger replaced a placeholder that was just activated). */
  defaultOpen?: boolean;
  items: ItemType[] | (() => ItemType[]);
}

const DropdownMenu = memo<DropdownMenuProps>(({ items, className, defaultOpen }) => {
  return (
    <DropdownMenuUI defaultOpen={defaultOpen} items={items}>
      <ActionIcon className={className} icon={MoreHorizontalIcon} size={'small'} />
    </DropdownMenuUI>
  );
});

export default DropdownMenu;
