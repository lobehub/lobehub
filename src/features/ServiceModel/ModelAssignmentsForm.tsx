'use client';

import type { FormGroupItemType, FormItemProps } from '@lobehub/ui';
import { Flexbox, Form, Icon, Skeleton } from '@lobehub/ui';
import { Switch } from 'antd';
import isEqual from 'fast-deep-equal';
import { Loader2Icon } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import ModelSelect from '@/features/ModelSelect';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';
import type { SystemAgentItem, UserSystemAgentConfigKey } from '@/types/user/settings';

interface SystemAgentModelItem {
  key: UserSystemAgentConfigKey;
}

type LoadingKey = 'defaultAgent' | UserSystemAgentConfigKey;

const SYSTEM_AGENT_MODEL_ITEMS: SystemAgentModelItem[] = [
  { key: 'topic' },
  { key: 'generationTopic' },
  { key: 'translation' },
  { key: 'historyCompress' },
  { key: 'agentMeta' },
];

const OPTIONAL_FEATURE_ITEMS: SystemAgentModelItem[] = [
  { key: 'inputCompletion' },
  { key: 'promptRewrite' },
];

const ModelAssignmentsForm = memo(() => {
  const { t } = useTranslation('setting');
  const [defaultAgent, systemAgentSettings] = useUserStore(
    (s) => [settingsSelectors.defaultAgent(s), settingsSelectors.currentSystemAgent(s)],
    isEqual,
  );
  const [updateDefaultAgent, updateSystemAgent, isUserStateInit] = useUserStore((s) => [
    s.updateDefaultAgent,
    s.updateSystemAgent,
    s.isUserStateInit,
  ]);
  const [loadingKey, setLoadingKey] = useState<LoadingKey>();

  useEffect(() => {
    if (loadingKey === 'defaultAgent') setLoadingKey(undefined);
  }, [defaultAgent.config.model, defaultAgent.config.provider, loadingKey]);

  if (!isUserStateInit) return <Skeleton active paragraph={{ rows: 8 }} title={false} />;

  const updateDefaultAgentModel = async ({
    model,
    provider,
  }: {
    model: string;
    provider: string;
  }) => {
    setLoadingKey('defaultAgent');
    try {
      await updateDefaultAgent({ config: { model, provider } });
    } finally {
      setLoadingKey(undefined);
    }
  };

  const updateSystemAgentModel = async (
    key: UserSystemAgentConfigKey,
    value: Partial<SystemAgentItem>,
  ) => {
    setLoadingKey(key);
    try {
      await updateSystemAgent(key, value);
    } finally {
      setLoadingKey(undefined);
    }
  };

  const defaultAgentItem: FormItemProps = {
    children: (
      <Flexbox align="center" direction="horizontal" gap={12} style={{ width: 'min(100%, 448px)' }}>
        <ModelSelect
          showAbility={false}
          style={{ minWidth: 0, width: '100%' }}
          value={defaultAgent.config}
          onChange={updateDefaultAgentModel}
        />
      </Flexbox>
    ),
    desc: t('defaultAgent.model.desc'),
    label: t('defaultAgent.title'),
    minWidth: undefined,
  };

  const systemModelItems: FormItemProps[] = SYSTEM_AGENT_MODEL_ITEMS.map(({ key }) => {
    const value = systemAgentSettings[key];

    return {
      children: (
        <Flexbox
          align="center"
          direction="horizontal"
          gap={12}
          style={{ width: 'min(100%, 448px)' }}
        >
          <ModelSelect
            showAbility={false}
            style={{ minWidth: 0, width: '100%' }}
            value={value}
            onChange={(props) => updateSystemAgentModel(key, props)}
          />
        </Flexbox>
      ),
      desc: t(`systemAgent.${key}.modelDesc`),
      label: t(`systemAgent.${key}.title`),
      minWidth: undefined,
    } satisfies FormItemProps;
  });

  const optionalFeatureItems: FormItemProps[] = OPTIONAL_FEATURE_ITEMS.map(({ key }) => {
    const value = systemAgentSettings[key];
    const disabled = value.enabled === false;

    return {
      children: (
        <Flexbox
          align="center"
          direction="horizontal"
          gap={12}
          style={{ width: 'min(100%, 448px)' }}
        >
          <ModelSelect
            showAbility={false}
            style={{ minWidth: 0, width: '100%' }}
            value={value}
            onChange={(props) => updateSystemAgentModel(key, props)}
          />
          <Flexbox align="center" direction="horizontal" gap={8}>
            <Switch
              aria-label={t(`systemAgent.${key}.title`)}
              checked={value.enabled}
              loading={loadingKey === key}
              onChange={(enabled) => updateSystemAgentModel(key, { enabled })}
            />
          </Flexbox>
        </Flexbox>
      ),
      desc: t(`systemAgent.${key}.modelDesc`),
      label: (
        <span
          style={{
            opacity: disabled ? 0.45 : 1,
          }}
        >
          {t(`systemAgent.${key}.title`)}
        </span>
      ),
      minWidth: undefined,
    } satisfies FormItemProps;
  });

  const isOptionalFeatureLoading =
    loadingKey === 'inputCompletion' || loadingKey === 'promptRewrite';
  const isModelAssignmentLoading = loadingKey && !isOptionalFeatureLoading;

  const modelAssignments: FormGroupItemType = {
    children: [defaultAgentItem, ...systemModelItems],
    extra: isModelAssignmentLoading && (
      <Icon spin icon={Loader2Icon} size={16} style={{ opacity: 0.5 }} />
    ),
    title: t('serviceModel.modelAssignments.title'),
  };

  const optionalFeatures: FormGroupItemType = {
    children: optionalFeatureItems,
    extra: isOptionalFeatureLoading && (
      <Icon spin icon={Loader2Icon} size={16} style={{ opacity: 0.5 }} />
    ),
    title: t('serviceModel.optionalFeatures.title'),
  };

  return (
    <Form
      collapsible={false}
      items={[modelAssignments, optionalFeatures]}
      itemsType={'group'}
      variant={'filled'}
      {...FORM_STYLE}
    />
  );
});

ModelAssignmentsForm.displayName = 'ModelAssignmentsForm';

export default ModelAssignmentsForm;
