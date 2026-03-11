'use client';

import { type FormGroupItemType } from '@lobehub/ui';
import { Form, Icon, Skeleton } from '@lobehub/ui';
import { Switch } from '@lobehub/ui/base-ui';
import isEqual from 'fast-deep-equal';
import { Loader2Icon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

const Page = memo(() => {
  const { t } = useTranslation('setting');

  const general = useUserStore((s) => settingsSelectors.currentSettings(s).general, isEqual);
  const [setSettings, isUserStateInit] = useUserStore((s) => [s.setSettings, s.isUserStateInit]);
  const [loading, setLoading] = useState(false);

  if (!isUserStateInit) return <Skeleton active paragraph={{ rows: 5 }} title={false} />;

  const advancedGroup: FormGroupItemType = {
    children: [
      {
        children: <Switch />,
        desc: t('settingCommon.devMode.desc'),
        label: t('settingCommon.devMode.title'),
        minWidth: undefined,
        name: 'isDevMode',
        valuePropName: 'checked',
      },
    ],
    extra: loading && <Icon spin icon={Loader2Icon} size={16} style={{ opacity: 0.5 }} />,
    title: t('tab.advanced'),
  };

  return (
    <>
      <SettingHeader title={t('tab.advanced')} />
      <Form
        collapsible={false}
        initialValues={general}
        items={[advancedGroup]}
        itemsType={'group'}
        variant={'filled'}
        onValuesChange={async (v) => {
          setLoading(true);
          await setSettings({ general: v });
          setLoading(false);
        }}
        {...FORM_STYLE}
      />
    </>
  );
});

export default Page;
