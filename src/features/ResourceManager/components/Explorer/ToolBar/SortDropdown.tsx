import { type DropdownItem, DropdownMenu, Icon } from '@lobehub/ui';
import { Check } from 'lucide-react';
import { memo } from 'react';

import ActionIconWithChevron from './ActionIconWithChevron';
import { useSortDropdown } from './useSortDropdown';

const SortDropdown = memo(() => {
  const { currentSortIcon, currentSortLabel, menuItems } = useSortDropdown();
  const items = menuItems.map<DropdownItem>((item) => {
    if (item.type === 'divider') return item;

    const { checked, icon, ...props } = item;
    return {
      ...props,
      extra: checked ? <Icon icon={Check} /> : undefined,
      icon: <Icon icon={icon} />,
    };
  });

  return (
    <DropdownMenu items={items}>
      <ActionIconWithChevron icon={currentSortIcon} title={currentSortLabel} />
    </DropdownMenu>
  );
});

SortDropdown.displayName = 'SortDropdown';

export default SortDropdown;
