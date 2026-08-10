'use client';

import { ActionIcon, DropdownMenu } from '@lobehub/ui';
import { MoreHorizontal, SquareTerminalIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { isDesktop } from '@/const/version';
import HeaderSlot from '@/routes/(main)/agent/(chat)/_layout/HeaderSlot';
import { useGlobalStore } from '@/store/global';

import { useMenu } from './useMenu';

const HeaderActions = memo(() => {
  const { t } = useTranslation('chat');
  const { menuHeader, menuItems } = useMenu();
  const toggleTerminalPanel = useGlobalStore((s) => s.toggleTerminalPanel);

  return (
    <>
      <HeaderSlot.Outlet />
      {isDesktop && (
        <ActionIcon
          icon={SquareTerminalIcon}
          size={'small'}
          title={t('terminalPanel.title')}
          tooltipProps={{ placement: 'bottom' }}
          onClick={() => toggleTerminalPanel(true)}
        />
      )}
      <DropdownMenu header={menuHeader} items={menuItems}>
        <ActionIcon icon={MoreHorizontal} size={'small'} />
      </DropdownMenu>
    </>
  );
});

HeaderActions.displayName = 'HeaderActions';

export default HeaderActions;
