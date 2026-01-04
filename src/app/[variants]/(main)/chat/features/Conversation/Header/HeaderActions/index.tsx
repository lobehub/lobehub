'use client';

import { ActionIcon, Dropdown } from '@lobehub/ui';
import type { MenuProps } from '@lobehub/ui';
import { MoreHorizontal } from 'lucide-react';
import { memo } from 'react';

import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';

import { useMenu } from './useMenu';

const HeaderActions = memo(() => {
  const { menuItems } = useMenu();

  return (
    <Dropdown
      arrow={false}
      menu={{
        items: menuItems as MenuProps['items'],
        onClick: ({ domEvent }) => {
          domEvent.stopPropagation();
        },
      }}
      trigger={['click']}
    >
      <ActionIcon icon={MoreHorizontal} size={DESKTOP_HEADER_ICON_SIZE} />
    </Dropdown>
  );
});

HeaderActions.displayName = 'HeaderActions';

export default HeaderActions;
