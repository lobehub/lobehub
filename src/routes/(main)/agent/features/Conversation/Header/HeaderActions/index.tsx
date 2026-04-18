'use client';

import { ActionIcon, DropdownMenu } from '@lobehub/ui';
import { MoreHorizontal } from 'lucide-react';
import { memo } from 'react';

import { useMenu } from './useMenu';

const HeaderActions = memo(() => {
  const { menuItems } = useMenu();

  return (
    <DropdownMenu items={menuItems}>
      <ActionIcon icon={MoreHorizontal} size={'small'} />
    </DropdownMenu>
  );
});

HeaderActions.displayName = 'HeaderActions';

export default HeaderActions;
