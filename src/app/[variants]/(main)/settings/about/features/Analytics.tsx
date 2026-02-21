'use client';

import { BRANDING_NAME } from '@lobechat/business-const';
import { type FormGroupItemType } from '@lobehub/ui';
import { Form } from '@lobehub/ui';
import { Switch } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

const Analytics = memo(() => {
  const { t } = useTranslation('setting');
  const checked = useUserStore(userGeneralSettingsSelectors.telemetry);
  const updateGeneralConfig = useUserStore((s) => s.updateGeneralConfig);

  const items: FormGroupItemType = {
    children: [
      {
        children: (
          <Switch
            checked={!!checked}
            onChange={(e) => {
              updateGeneralConfig({ telemetry: e });
            }}
          />
        ),
        desc: t('analytics.telemetry.desc', { appName: BRANDING_NAME }),
        label: t('analytics.telemetry.title'),
        minWidth: undefined,
        valuePropName: 'checked',
      },
    ],
    title: t('analytics.title'),
  };

  return (
    <Form
      collapsible={false}
      items={[items]}
      itemsType={'group'}
      variant={'filled'}
      {...FORM_STYLE}
    />
  );
});

export default Analytics;
