'use client';

import { type MenuProps } from '@lobehub/ui';
import { ActionIcon, DropdownMenu } from '@lobehub/ui';
import { MoreHorizontal } from 'lucide-react';
import { memo } from 'react';

import { useDropdownMenu } from './useDropdownMenu';

const Actions = memo(() => {
  const items: MenuProps['items'] = useDropdownMenu();

  return (
    <DropdownMenu items={items}>
      <ActionIcon icon={MoreHorizontal} size={'small'} />
    </DropdownMenu>
  );
});

export default Actions;
