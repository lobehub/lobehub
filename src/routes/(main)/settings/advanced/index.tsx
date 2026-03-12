'use client';

import { type FormGroupItemType } from '@lobehub/ui';
import { Form, Icon, Skeleton } from '@lobehub/ui';
import { Switch } from 'antd';
import { createStaticStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { Loader2Icon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';
import { useUserStore } from '@/store/user';
import { labPreferSelectors, preferenceSelectors, settingsSelectors } from '@/store/user/selectors';

const styles = createStaticStyles(({ css }) => ({
  labItem: css`
    .ant-form-item-row {
      align-items: center !important;
    }
  `,
}));

const Page = memo(() => {
  const { t } = useTranslation('setting');
  const { t: tLabs } = useTranslation('labs');

  const general = useUserStore((s) => settingsSelectors.currentSettings(s).general, isEqual);
  const [setSettings, isUserStateInit] = useUserStore((s) => [s.setSettings, s.isUserStateInit]);
  const [loading, setLoading] = useState(false);

  const [isPreferenceInit, enableInputMarkdown, updateLab] = useUserStore((s) => [
    preferenceSelectors.isPreferenceInit(s),
    labPreferSelectors.enableInputMarkdown(s),
    s.updateLab,
  ]);

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

  const labsGroup: FormGroupItemType = {
    children: [
      {
        avatar: (
          <img
            alt={tLabs('features.inputMarkdown.title')}
            src="https://github.com/user-attachments/assets/0527a966-3d95-46b4-b880-c0f3fca18f02"
            style={{ borderRadius: 8, height: 72, marginRight: 12, objectFit: 'cover', width: 120 }}
          />
        ),
        children: (
          <Switch
            checked={enableInputMarkdown}
            loading={!isPreferenceInit}
            onChange={(checked) => updateLab({ enableInputMarkdown: checked })}
          />
        ),
        className: styles.labItem,
        desc: tLabs('features.inputMarkdown.desc'),
        label: tLabs('features.inputMarkdown.title'),
        minWidth: undefined,
      },
    ],
    title: tLabs('title'),
  };

  return (
    <>
      <SettingHeader title={t('tab.advanced')} />
      <Form
        collapsible={false}
        initialValues={general}
        items={[advancedGroup, labsGroup]}
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
