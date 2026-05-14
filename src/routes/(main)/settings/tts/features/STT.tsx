'use client';

import { type FormGroupItemType } from '@lobehub/ui';
import { Form, Icon, Select, Skeleton } from '@lobehub/ui';
import { Switch } from 'antd';
import isEqual from 'fast-deep-equal';
import { Loader2Icon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

import {
  openAIRealtimeModelOptions,
  sttOptions,
  voiceCallModeOptions,
  voiceCallProviderOptions,
} from './const';

const STT = memo(() => {
  const { t } = useTranslation('setting');
  const [form] = Form.useForm();
  const { tts } = useUserStore(settingsSelectors.currentSettings, isEqual);
  const [setSettings, isUserStateInit] = useUserStore((s) => [s.setSettings, s.isUserStateInit]);
  const [loading, setLoading] = useState(false);

  if (!isUserStateInit) return <Skeleton active paragraph={{ rows: 5 }} title={false} />;

  const stt: FormGroupItemType = {
    children: [
      {
        children: <Select options={sttOptions} />,
        desc: t('settingTTS.sttService.desc'),
        label: t('settingTTS.sttService.title'),
        name: 'sttServer',
      },
      {
        children: <Switch />,
        desc: t('settingTTS.sttAutoStop.desc'),
        label: t('settingTTS.sttAutoStop.title'),
        layout: 'horizontal',
        minWidth: undefined,
        name: 'sttAutoStop',
        valuePropName: 'checked',
      },
    ],
    extra: loading && <Icon spin icon={Loader2Icon} size={16} style={{ opacity: 0.5 }} />,
    title: t('settingTTS.stt'),
  };

  const voiceInput: FormGroupItemType = {
    children: [
      {
        children: <Switch />,
        desc: t('settingTTS.voiceInput.enabled.desc'),
        label: t('settingTTS.voiceInput.enabled.title'),
        layout: 'horizontal',
        minWidth: undefined,
        name: ['voiceInput', 'enabled'],
        valuePropName: 'checked',
      },
    ],
    title: t('settingTTS.voiceInput.title'),
  };

  const voiceCall: FormGroupItemType = {
    children: [
      {
        children: <Switch />,
        desc: t('settingTTS.voiceCall.enabled.desc'),
        label: t('settingTTS.voiceCall.enabled.title'),
        layout: 'horizontal',
        minWidth: undefined,
        name: ['voiceCall', 'enabled'],
        valuePropName: 'checked',
      },
      {
        children: <Select options={voiceCallModeOptions} />,
        desc: t('settingTTS.voiceCall.mode.desc'),
        label: t('settingTTS.voiceCall.mode.title'),
        name: ['voiceCall', 'mode'],
      },
      {
        children: <Select options={voiceCallProviderOptions} />,
        desc: t('settingTTS.voiceCall.provider.desc'),
        label: t('settingTTS.voiceCall.provider.title'),
        name: ['voiceCall', 'provider'],
      },
      {
        children: <Select options={openAIRealtimeModelOptions} />,
        desc: t('settingTTS.voiceCall.openAIRealtimeModel.desc'),
        label: t('settingTTS.voiceCall.openAIRealtimeModel.title'),
        name: ['voiceCall', 'openAIRealtimeModel'],
      },
      {
        children: <Switch />,
        desc: t('settingTTS.voiceCall.autoSpeak.desc'),
        label: t('settingTTS.voiceCall.autoSpeak.title'),
        layout: 'horizontal',
        minWidth: undefined,
        name: ['voiceCall', 'autoSpeak'],
        valuePropName: 'checked',
      },
    ],
    title: t('settingTTS.voiceCall.title'),
  };

  return (
    <Form
      collapsible={false}
      form={form}
      initialValues={tts}
      items={[stt, voiceInput, voiceCall]}
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

export default STT;
