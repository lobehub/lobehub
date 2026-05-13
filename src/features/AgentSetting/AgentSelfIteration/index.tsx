'use client';

import type { FormGroupItemType } from '@lobehub/ui';
import { Form } from '@lobehub/ui';
import { Switch } from 'antd';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';

import { selectors, useStore } from '../store';

const AgentSelfIteration = memo(() => {
  const { t } = useTranslation('setting');
  const [form] = Form.useForm();
  const updateConfig = useStore((s) => s.setChatConfig);
  const config = useStore(selectors.currentChatConfig, isEqual);
  const isInbox = useAgentStore(builtinAgentSelectors.isInboxAgent);

  const selfIterationItem = isInbox
    ? {
        children: <Switch checked disabled />,
        desc: t('settingSelfIteration.enabled.managedDesc'),
        label: t('settingSelfIteration.enabled.title'),
        layout: 'horizontal' as const,
        minWidth: undefined,
      }
    : {
        children: <Switch />,
        desc: t('settingSelfIteration.enabled.desc'),
        label: t('settingSelfIteration.enabled.title'),
        layout: 'horizontal' as const,
        minWidth: undefined,
        name: ['selfIteration', 'enabled'],
        valuePropName: 'checked',
      };

  const selfIteration: FormGroupItemType = {
    children: [selfIterationItem],
    title: t('settingSelfIteration.title'),
  };

  return (
    <Form
      footer={isInbox ? undefined : <Form.SubmitFooter />}
      form={form}
      initialValues={config}
      items={[selfIteration]}
      itemsType={'group'}
      variant={'borderless'}
      onFinish={updateConfig}
      {...FORM_STYLE}
    />
  );
});

export default AgentSelfIteration;
