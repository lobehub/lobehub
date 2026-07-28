'use client';

import { isDesktop } from '@lobechat/const';
import type { TrayClickBehavior } from '@lobechat/electron-client-ipc';
import { type FormGroupItemType } from '@lobehub/ui';
import { Form } from '@lobehub/ui';
import { Select, Switch } from '@lobehub/ui/base-ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import { SettingsSearchAnchor } from '@/features/SettingsSearch/anchor';
import { useElectronStore } from '@/store/electron';
import { getPlatform } from '@/utils/platform';

const isWindows = getPlatform() === 'Windows';

const Desktop = memo(() => {
  const { t } = useTranslation('setting');
  const [trayVisibleLoading, setTrayVisibleLoading] = useState(false);
  const [clickBehaviorLoading, setClickBehaviorLoading] = useState(false);
  const [
    appTrayVisible,
    trayClickBehavior,
    setAppTrayVisible,
    setTrayClickBehavior,
    useGetAppTrayVisible,
    useGetTrayClickBehavior,
  ] = useElectronStore((s) => [
    s.appTrayVisible,
    s.trayClickBehavior,
    s.setAppTrayVisible,
    s.setTrayClickBehavior,
    s.useGetAppTrayVisible,
    s.useGetTrayClickBehavior,
  ]);

  useGetAppTrayVisible(isDesktop);
  useGetTrayClickBehavior(isDesktop && isWindows);

  if (!isDesktop) return null;

  const desktop: FormGroupItemType = {
    children: [
      {
        children: (
          <Switch
            checked={appTrayVisible}
            loading={trayVisibleLoading}
            onChange={async (checked: boolean) => {
              setTrayVisibleLoading(true);
              try {
                await setAppTrayVisible(checked);
              } finally {
                setTrayVisibleLoading(false);
              }
            }}
          />
        ),
        label: (
          <SettingsSearchAnchor id={'appearance-app-tray'}>
            {t('settingAppearance.appTray.title')}
          </SettingsSearchAnchor>
        ),
        minWidth: undefined,
      },
      ...(isWindows
        ? [
            {
              children: (
                <Select
                  disabled={clickBehaviorLoading}
                  value={trayClickBehavior}
                  options={[
                    { label: t('settingAppearance.trayClick.menu'), value: 'menu' },
                    {
                      label: t('settingAppearance.trayClick.showMainWindow'),
                      value: 'showMainWindow',
                    },
                    {
                      label: t('settingAppearance.trayClick.quickComposer'),
                      value: 'quickComposer',
                    },
                  ]}
                  onChange={async (value: TrayClickBehavior) => {
                    setClickBehaviorLoading(true);
                    try {
                      await setTrayClickBehavior(value);
                    } finally {
                      setClickBehaviorLoading(false);
                    }
                  }}
                />
              ),
              desc: t('settingAppearance.trayClick.desc'),
              label: t('settingAppearance.trayClick.title'),
            },
          ]
        : []),
    ],
    title: t('settingAppearance.desktop.title'),
  };

  return (
    <Form
      collapsible={false}
      items={[desktop]}
      itemsType={'group'}
      variant={'filled'}
      {...FORM_STYLE}
    />
  );
});

export default Desktop;
