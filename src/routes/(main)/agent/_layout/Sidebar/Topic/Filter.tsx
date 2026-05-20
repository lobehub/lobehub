import { ActionIcon } from '@lobehub/ui';
import { DropdownMenu } from '@lobehub/ui/base-ui';
import { ListFilter } from 'lucide-react';
import { memo } from 'react';

import { useTopicFilterDropdownMenu } from './useFilterMenu';

const Filter = memo(() => {
  const menuItems = useTopicFilterDropdownMenu();

  return (
    <DropdownMenu items={menuItems}>
      <ActionIcon icon={ListFilter} size={'small'} />
    </DropdownMenu>
  );
});

export default Filter;
