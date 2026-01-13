'use client';

import { ActionIcon, Dropdown } from '@lobehub/ui';
import type { MenuProps } from '@lobehub/ui';
import { MoreHorizontal } from 'lucide-react';
import { memo } from 'react';

import { useDropdownMenu } from './useDropdownMenu';

const Actions = memo(() => {
  const items: MenuProps['items'] = useDropdownMenu();

  return (
    <Dropdown
      arrow={false}
      menu={{
        items,
        onClick: ({ domEvent }) => {
          domEvent.stopPropagation();
        },
      }}
      trigger={['click']}
    >
      <ActionIcon icon={MoreHorizontal} size={'small'} />
    </Dropdown>
  );
});

export default Actions;
