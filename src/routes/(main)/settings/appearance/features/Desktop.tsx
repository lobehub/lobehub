'use client';

import { isDesktop } from '@lobechat/const';
import { type FormGroupItemType } from '@lobehub/ui';
import { Form } from '@lobehub/ui';
import { Switch } from '@lobehub/ui/base-ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import { useElectronStore } from '@/store/electron';

const Desktop = memo(() => {
  const { t } = useTranslation('setting');
  const [loading, setLoading] = useState(false);
  const [appTrayVisible, setAppTrayVisible, useGetAppTrayVisible] = useElectronStore((s) => [
    s.appTrayVisible,
    s.setAppTrayVisible,
    s.useGetAppTrayVisible,
  ]);

  useGetAppTrayVisible(isDesktop);

  if (!isDesktop) return null;

  const desktop: FormGroupItemType = {
    children: [
      {
        children: (
          <Switch
            checked={appTrayVisible}
            loading={loading}
            onChange={async (checked: boolean) => {
              setLoading(true);
              try {
                await setAppTrayVisible(checked);
              } finally {
                setLoading(false);
              }
            }}
          />
        ),
        desc: t('settingAppearance.appTray.desc'),
        label: t('settingAppearance.appTray.title'),
        minWidth: undefined,
      },
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
