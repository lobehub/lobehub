'use client';

import { type DropdownMenuCheckboxItem } from '@lobehub/ui';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

export const useMenu = (): { menuItems: DropdownMenuCheckboxItem[] } => {
  const { t } = useTranslation('chat');

  const [wideScreen, toggleWideScreen] = useGlobalStore((s) => [
    systemStatusSelectors.wideScreen(s),
    s.toggleWideScreen,
  ]);

  const menuItems = useMemo<DropdownMenuCheckboxItem[]>(
    () => [
      {
        checked: wideScreen,
        key: 'full-width',
        label: t('viewMode.fullWidth'),
        onCheckedChange: toggleWideScreen,
        type: 'checkbox',
      },
    ],
    [t, wideScreen, toggleWideScreen],
  );

  return { menuItems };
};
