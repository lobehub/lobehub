'use client';

import { Switch } from '@lobehub/ui/base-ui';
import { Form, type FormFieldProps, useForm } from '@lobehub/ui/base-ui/form';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { type LobeAgentChatConfig } from '@/types/agent';

import { selectors, useStore } from '../store';

const AgentSelfIteration = memo(() => {
  const { t } = useTranslation('setting');
  const [disabled, updateConfig] = useStore((s) => [s.disabled, s.setChatConfig]);
  const config = useStore(selectors.currentChatConfig, isEqual);
  const isInbox = useAgentStore(builtinAgentSelectors.isInboxAgent);
  const form = useForm<LobeAgentChatConfig>({
    initialValues: config,
    onSubmit: (values) => {
      if (disabled) return;

      updateConfig(values);
    },
  });

  const selfIterationItem: FormFieldProps<LobeAgentChatConfig> = isInbox
    ? {
        children: <Switch checked disabled />,
        desc: t('settingSelfIteration.enabled.managedDesc'),
        label: t('settingSelfIteration.enabled.title'),
        layout: 'horizontal',
        minWidth: undefined,
      }
    : {
        children: <Switch disabled={disabled} />,
        desc: t('settingSelfIteration.enabled.desc'),
        label: t('settingSelfIteration.enabled.title'),
        layout: 'horizontal',
        minWidth: undefined,
        name: 'selfIteration.enabled',
      };

  return (
    <Form
      footer={isInbox ? undefined : <Form.SubmitFooter />}
      form={form}
      items={[selfIterationItem]}
      itemsType={'flat'}
      variant={'borderless'}
      {...FORM_STYLE}
    />
  );
});

export default AgentSelfIteration;
