import { ActionIcon, DropdownMenu } from '@lobehub/ui';
import { ListFilter } from 'lucide-react';
import { memo } from 'react';

import { useTopicListFilter } from './TopicListScope';
import { useTopicFilterDropdownMenu } from './useFilterMenu';

const Filter = memo(() => {
  const menuItems = useTopicFilterDropdownMenu();
  const filter = useTopicListFilter()?.filter;
  // A narrowed list must never read as the whole list.
  const filtered = !!(filter?.status || filter?.device);

  return (
    <DropdownMenu items={menuItems}>
      <ActionIcon active={filtered} icon={ListFilter} size={'small'} />
    </DropdownMenu>
  );
});

export default Filter;
