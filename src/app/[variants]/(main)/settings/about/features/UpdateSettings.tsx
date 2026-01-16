'use client';

import { DEFAULT_AUTO_CHECK_UPDATE } from '@lobechat/electron-client-ipc';
import { Form, type FormGroupItemType } from '@lobehub/ui';
import { Switch } from 'antd';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import { useElectronStore } from '@/store/electron';

const UpdateSettings = memo(() => {
  const { t } = useTranslation('setting');

  const [setAutoCheckUpdate, useFetchAutoCheckUpdate] = useElectronStore((s) => [
    s.setAutoCheckUpdate,
    s.useFetchAutoCheckUpdate,
  ]);

  const { data: autoCheckUpdate, isLoading } = useFetchAutoCheckUpdate();

  const handleChange = useCallback(
    (checked: boolean) => {
      setAutoCheckUpdate(checked);
    },
    [setAutoCheckUpdate],
  );

  const updateSettingsGroup: FormGroupItemType = {
    children: [
      {
        children: (
          <Switch
            checked={autoCheckUpdate ?? DEFAULT_AUTO_CHECK_UPDATE}
            loading={isLoading}
            onChange={handleChange}
          />
        ),
        desc: t('settingUpdate.autoCheckUpdate.desc'),
        label: t('settingUpdate.autoCheckUpdate.title'),
        layout: 'horizontal',
        minWidth: undefined,
      },
    ],
    title: t('settingUpdate.title'),
  };

  return (
    <Form
      collapsible={false}
      items={[updateSettingsGroup]}
      itemsType={'group'}
      variant={'filled'}
      {...FORM_STYLE}
    />
  );
});

export default UpdateSettings;
