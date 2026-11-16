import { ActionIcon, type DropdownItem, DropdownMenu, Icon } from '@lobehub/ui';
import { Check, ListFilter } from 'lucide-react';
import { memo } from 'react';

import { useSortDropdown } from './useSortDropdown';

const SortDropdown = memo(() => {
  const { currentSortLabel, menuItems } = useSortDropdown();
  const items = menuItems.map<DropdownItem>((item) => {
    if (item.type === 'divider') return item;

    return {
      ...item,
      children: item.children.map(({ checked, ...props }) => ({
        ...props,
        icon: checked ? <Icon icon={Check} /> : <div />,
      })),
    };
  });

  return (
    <DropdownMenu items={items}>
      <ActionIcon icon={ListFilter} size={'small'} title={currentSortLabel} />
    </DropdownMenu>
  );
});

SortDropdown.displayName = 'SortDropdown';

export default SortDropdown;
