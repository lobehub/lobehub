'use client';

import { type FormGroupItemType } from '@lobehub/ui';
import { Form, Icon, Select, Skeleton } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { Loader2Icon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

import { opeanaiSTTOptions, opeanaiTTSOptions } from './const';

const OpenAI = memo(() => {
  const { t } = useTranslation('setting');
  const [form] = Form.useForm();
  const { tts } = useUserStore(settingsSelectors.currentSettings, isEqual);
  const [setSettings, isUserStateInit] = useUserStore((s) => [s.setSettings, s.isUserStateInit]);
  const [loading, setLoading] = useState(false);

  if (!isUserStateInit) return <Skeleton active paragraph={{ rows: 5 }} title={false} />;

  const openai: FormGroupItemType = {
    children: [
      {
        children: <Select options={opeanaiTTSOptions} />,
        label: t('settingTTS.openai.ttsModel'),
        name: ['openAI', 'ttsModel'],
      },
      {
        children: <Select options={opeanaiSTTOptions} />,
        label: t('settingTTS.openai.sttModel'),
        name: ['openAI', 'sttModel'],
      },
    ],
    extra: loading && <Icon spin icon={Loader2Icon} size={16} style={{ opacity: 0.5 }} />,
    title: t('settingTTS.openai.title'),
  };

  return (
    <Form
      collapsible={false}
      form={form}
      initialValues={tts}
      items={[openai]}
      itemsType={'group'}
      variant={'filled'}
      onValuesChange={async (values) => {
        setLoading(true);
        await setSettings({
          tts: values,
        });
        setLoading(false);
      }}
      {...FORM_STYLE}
    />
  );
});

export default OpenAI;
