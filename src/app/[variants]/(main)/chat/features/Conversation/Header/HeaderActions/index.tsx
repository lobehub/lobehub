'use client';

import { ActionIcon, DropdownMenu } from '@lobehub/ui';
import { MoreHorizontal } from 'lucide-react';
import { memo } from 'react';

import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';

import { useMenu } from './useMenu';

const HeaderActions = memo(() => {
  const { menuItems } = useMenu();

  return (
    <DropdownMenu items={menuItems}>
      <ActionIcon icon={MoreHorizontal} size={DESKTOP_HEADER_ICON_SIZE} />
    </DropdownMenu>
  );
});

HeaderActions.displayName = 'HeaderActions';

export default HeaderActions;
