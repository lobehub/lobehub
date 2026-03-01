'use client';

import { type FormGroupItemType } from '@lobehub/ui';
import { Form, Icon, Skeleton } from '@lobehub/ui';
import { Switch } from 'antd';
import isEqual from 'fast-deep-equal';
import { Loader2Icon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

const MemorySetting = memo(() => {
  const { t } = useTranslation('setting');
  const [form] = Form.useForm();
  const { memory } = useUserStore(settingsSelectors.currentSettings, isEqual);
  const [setSettings, isUserStateInit] = useUserStore((s) => [s.setSettings, s.isUserStateInit]);
  const [loading, setLoading] = useState(false);

  if (!isUserStateInit) return <Skeleton active paragraph={{ rows: 3 }} title={false} />;

  const memorySettings: FormGroupItemType = {
    children: [
      {
        children: <Switch />,
        desc: t('memory.enabled.desc'),
        label: t('memory.enabled.title'),
        layout: 'horizontal',
        minWidth: undefined,
        name: 'enabled',
        valuePropName: 'checked',
      },
    ],
    extra: loading && <Icon spin icon={Loader2Icon} size={16} style={{ opacity: 0.5 }} />,
    title: t('memory.title'),
  };

  return (
    <Form
      collapsible={false}
      form={form}
      initialValues={memory}
      items={[memorySettings]}
      itemsType={'group'}
      variant={'filled'}
      onValuesChange={async (values) => {
        setLoading(true);
        await setSettings({ memory: values });
        setLoading(false);
      }}
      {...FORM_STYLE}
    />
  );
});

export default MemorySetting;
