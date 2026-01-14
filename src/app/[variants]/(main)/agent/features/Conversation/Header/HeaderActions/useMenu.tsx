'use client';

import type { DropdownItem } from '@lobehub/ui/es/DropdownMenu/type';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

export const useMenu = (): { menuItems: DropdownItem[] } => {
  const { t } = useTranslation('chat');

  const [wideScreen, toggleWideScreen] = useGlobalStore((s) => [
    systemStatusSelectors.wideScreen(s),
    s.toggleWideScreen,
  ]);

  const menuItems = useMemo<DropdownItem[]>(
    () => [
      {
        checked: wideScreen,
        key: 'full-width',
        label: t('viewMode.fullWidth'),
        onCheckedChange: toggleWideScreen,
        type: 'switch',
      },
    ],
    [t, wideScreen, toggleWideScreen],
  );

  return { menuItems };
};
