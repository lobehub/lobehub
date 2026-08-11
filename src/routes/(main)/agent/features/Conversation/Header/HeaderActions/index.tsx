'use client';

import { ActionIcon, DropdownMenu } from '@lobehub/ui';
import { MoreHorizontal } from 'lucide-react';
import { memo } from 'react';

import HeaderSlot from '@/routes/(main)/agent/(chat)/_layout/HeaderSlot';

import { useMenu } from './useMenu';

const HeaderActions = memo(() => {
  const { menuHeader, menuItems } = useMenu();

  return (
    <>
      <HeaderSlot.Outlet />
      <DropdownMenu header={menuHeader} items={menuItems}>
        <ActionIcon icon={MoreHorizontal} size={'small'} />
      </DropdownMenu>
    </>
  );
});

HeaderActions.displayName = 'HeaderActions';

export default HeaderActions;
