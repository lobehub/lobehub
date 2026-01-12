'use client';

import { Flexbox } from '@lobehub/ui';
import { Switch } from 'antd';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

export const useMenu = (): { menuItems: any[] } => {
  const { t } = useTranslation('chat');

  const [wideScreen, toggleWideScreen] = useGlobalStore((s) => [
    systemStatusSelectors.wideScreen(s),
    s.toggleWideScreen,
  ]);

  const menuItems = useMemo(
    () => [
      {
        key: 'full-width',
        label: (
          <Flexbox align="center" horizontal justify="space-between">
            <span>{t('viewMode.fullWidth')}</span>
            <Switch
              checked={wideScreen}
              onChange={toggleWideScreen}
              onClick={(checked, event) => {
                event.stopPropagation();
              }}
              size="small"
            />
          </Flexbox>
        ),
      },
    ],
    [t, wideScreen, toggleWideScreen],
  );

  return { menuItems };
};
