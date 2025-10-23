'use client';

import {
  Form,
  type FormGroupItemType,
  Icon,
  Segmented,
  Select,
  SliderWithInput,
} from '@lobehub/ui';
import { Form as AntdForm, App, Input, Switch } from 'antd';
import { isEqual } from 'lodash';
import { Coffee, Rabbit, Turtle } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';

import ModelSelect from '../ModelSelect';
import { selectors, useStore } from './store';

const { TextArea } = Input;

/**
 * Chat Settings for Agent Team (Group Chat)
 */
const AgentTeamChatSettings = memo(() => {
  const { t } = useTranslation(['setting', 'common']);
  const [form] = Form.useForm();
  const updateConfig = useStore((s) => s.updateGroupConfig);
  const config = useStore(selectors.currentChatConfig, isEqual);

  const { message } = App.useApp();

  // Watch the allowDM value to conditionally show revealDM
  const allowDM = AntdForm.useWatch('allowDM', form);
  // Watch the enableSupervisor value to conditionally show host options
  const enableSupervisor = AntdForm.useWatch('enableSupervisor', form);

  const responseSpeedOptions = [
    {
      icon: <Icon icon={Turtle} size={16} />,
      label: t('settingGroupChat.responseSpeed.options.slow'),
      value: 'slow',
    },
    {
      icon: <Icon icon={Coffee} size={16} />,
      label: t('settingGroupChat.responseSpeed.options.medium'),
      value: 'medium',
    },
    {
      icon: <Icon icon={Rabbit} size={16} />,
      label: t('settingGroupChat.responseSpeed.options.fast'),
      value: 'fast',
    },
  ];

  const supervisorOptions: FormGroupItemType = {
    children: [
      {
        children: <Switch />,
        desc: t('settingGroupChat.enableSupervisor.desc'),
        divider: false,
        label: t('settingGroupChat.enableSupervisor.title'),
        name: 'enableSupervisor',
      },
      // Only show other options when enableSupervisor is true
      ...(enableSupervisor
        ? [
            {
              children: <ModelSelect requiredAbilities={['structuredOutput']} />,
              desc: t('settingGroupChat.model.desc'),
              label: t('settingGroupChat.model.title'),
              name: '_modelConfig',
            },
            {
              children: (
                <TextArea
                  autoSize={{ maxRows: 8, minRows: 3 }}
                  placeholder={t('settingGroupChat.systemPrompt.placeholder')}
                  rows={4}
                />
              ),
              desc: t('settingGroupChat.systemPrompt.desc'),
              label: t('settingGroupChat.systemPrompt.title'),
              name: 'systemPrompt',
            },
          ]
        : []),
    ],
    title: t('settingGroupChat.orchestratorTitle'),
  };

  const chatOptions: FormGroupItemType = {
    children: [
      {
        children: <Segmented options={responseSpeedOptions} />,
        desc: t('settingGroupChat.responseSpeed.desc'),
        label: t('settingGroupChat.responseSpeed.title'),
        name: 'responseSpeed',
      },
      {
        children: (
          <Select
            options={[
              {
                label: t('settingGroupChat.responseOrder.options.sequential'),
                value: 'sequential',
              },
              { label: t('settingGroupChat.responseOrder.options.natural'), value: 'natural' },
            ]}
            placeholder={t('settingGroupChat.responseOrder.placeholder')}
          />
        ),
        desc: t('settingGroupChat.responseOrder.desc'),
        label: t('settingGroupChat.responseOrder.title'),
        name: 'responseOrder',
      },
      {
        children: <SliderWithInput max={32} min={0} step={1} unlimitedInput={true} />,
        desc: t('settingGroupChat.maxResponseInRow.desc'),
        divider: false,
        label: t('settingGroupChat.maxResponseInRow.title'),
        name: 'maxResponseInRow',
      },
      {
        children: <Switch />,
        desc: t('settingGroupChat.allowDM.desc'),
        divider: false,
        label: t('settingGroupChat.allowDM.title'),
        name: 'allowDM',
      },
      // Only show revealDM when allowDM is true
      ...(allowDM
        ? [
            {
              children: <Switch />,
              desc: t('settingGroupChat.revealDM.desc'),
              divider: false,
              label: t('settingGroupChat.revealDM.title'),
              name: 'revealDM',
            },
          ]
        : []),
    ],
    title: t('settingGroupChat.title'),
  };

  return (
    <Form
      footer={
        <Form.SubmitFooter
          texts={{
            reset: t('submitFooter.reset'),
            submit: t('submitFooter.submit'),
            unSaved: t('submitFooter.unSaved'),
            unSavedWarning: t('submitFooter.unSavedWarning'),
          }}
        />
      }
      form={form}
      initialValues={{
        ...config,
        _modelConfig: {
          model: config?.orchestratorModel,
          provider: config?.orchestratorProvider,
        },
        enableSupervisor: config?.enableSupervisor ?? true,
      }}
      items={[supervisorOptions, ...(enableSupervisor ? [chatOptions] : [])]}
      itemsType={'group'}
      onFinish={async ({ _modelConfig, ...rest }) => {
        await updateConfig({
          // Preserve existing values when _modelConfig is undefined (enableSupervisor is false)
          orchestratorModel: _modelConfig?.model ?? config?.orchestratorModel,
          orchestratorProvider: _modelConfig?.provider ?? config?.orchestratorProvider,
          ...rest,
        });

        message.success(t('message.success'));
      }}
      variant={'borderless'}
      {...FORM_STYLE}
    />
  );
});

export default AgentTeamChatSettings;
