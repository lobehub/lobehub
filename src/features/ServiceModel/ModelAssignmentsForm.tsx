'use client';

import type { FormGroupItemType, FormItemProps } from '@lobehub/ui';
import { Flexbox, Form, Icon, InputNumber, Skeleton, Tooltip } from '@lobehub/ui';
import { Switch } from '@lobehub/ui/base-ui';
import { ConfigProvider } from 'antd';
import isEqual from 'fast-deep-equal';
import { Loader2Icon } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { FORM_STYLE } from '@/const/layoutTokens';
import ModelSelect from '@/features/ModelSelect';
import { usePermission } from '@/hooks/usePermission';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';
import type { SystemAgentItem, UserServiceModelConfigKey } from '@/types/user/settings';

interface SystemAgentModelItem {
  contextLimit?: boolean;
  key: UserServiceModelConfigKey;
}

type LoadingKey = 'defaultAgent' | UserServiceModelConfigKey;

const SYSTEM_AGENT_MODEL_ITEMS: SystemAgentModelItem[] = [
  { key: 'topic' },
  { key: 'generationTopic' },
  { key: 'translation' },
  { key: 'historyCompress' },
  { key: 'agentMeta' },
];

const OPTIONAL_FEATURE_ITEMS: SystemAgentModelItem[] = [
  { key: 'followUpAction' },
  { key: 'inputCompletion' },
  { key: 'promptRewrite' },
];

const MEMORY_MODEL_ITEMS: SystemAgentModelItem[] = [
  { contextLimit: true, key: 'memoryAnalysisAgentConfig' },
  { contextLimit: true, key: 'userMemoryPersonaWriter' },
  { contextLimit: true, key: 'userMemoryEmbedding' },
];

const ModelAssignmentsForm = memo(() => {
  const { t } = useTranslation('setting');
  const { allowed: canManageServiceModel, reason } = usePermission('manage_settings');
  const [defaultAgent, systemAgentSettings] = useUserStore(
    (s) => [settingsSelectors.defaultAgent(s), settingsSelectors.currentSystemAgent(s)],
    isEqual,
  );
  const [
    updateDefaultAgent,
    updateSystemAgent,
    isUserStateInit,
    isUserStateInitError,
    refreshUserState,
  ] = useUserStore((s) => [
    s.updateDefaultAgent,
    s.updateSystemAgent,
    s.isUserStateInit,
    s.isUserStateInitError,
    s.refreshUserState,
  ]);
  const [loadingKey, setLoadingKey] = useState<LoadingKey>();

  useEffect(() => {
    if (loadingKey === 'defaultAgent') setLoadingKey(undefined);
  }, [defaultAgent.config.model, defaultAgent.config.provider, loadingKey]);

  if (!isUserStateInit) {
    // A failed user-state init must show error + Retry, not a permanent skeleton
    if (isUserStateInitError)
      return (
        <AsyncError
          error={isUserStateInitError}
          variant={'block'}
          onRetry={() => refreshUserState()}
        />
      );
    return <Skeleton active paragraph={{ rows: 8 }} title={false} />;
  }

  const updateDefaultAgentModel = async ({
    model,
    provider,
  }: {
    model: string;
    provider: string;
  }) => {
    if (!canManageServiceModel) return;

    setLoadingKey('defaultAgent');
    try {
      await updateDefaultAgent({ config: { model, provider } });
    } finally {
      setLoadingKey(undefined);
    }
  };

  const updateSystemAgentModel = async (
    key: UserServiceModelConfigKey,
    value: Partial<SystemAgentItem>,
  ) => {
    if (!canManageServiceModel) return;

    setLoadingKey(key);
    try {
      await updateSystemAgent(key, value);
    } finally {
      setLoadingKey(undefined);
    }
  };

  const defaultAgentItem: FormItemProps = {
    children: (
      <Tooltip title={reason}>
        <Flexbox
          align="center"
          direction="horizontal"
          gap={12}
          style={{ width: 'min(100%, 448px)' }}
        >
          <ModelSelect
            disabled={!canManageServiceModel}
            showAbility={false}
            style={{ minWidth: 0, width: '100%' }}
            value={defaultAgent.config}
            onChange={updateDefaultAgentModel}
          />
        </Flexbox>
      </Tooltip>
    ),
    desc: t('defaultAgent.model.desc'),
    label: t('defaultAgent.title'),
  };

  const systemModelItems: FormItemProps[] = SYSTEM_AGENT_MODEL_ITEMS.map(({ key }) => {
    const value = systemAgentSettings[key];

    return {
      children: (
        <Tooltip title={reason}>
          <Flexbox
            align="center"
            direction="horizontal"
            gap={12}
            style={{ width: 'min(100%, 448px)' }}
          >
            <ModelSelect
              disabled={!canManageServiceModel}
              showAbility={false}
              style={{ minWidth: 0, width: '100%' }}
              value={value}
              onChange={(props) => updateSystemAgentModel(key, props)}
            />
          </Flexbox>
        </Tooltip>
      ),
      desc: t(`systemAgent.${key}.modelDesc`),
      label: t(`systemAgent.${key}.title`),
    } satisfies FormItemProps;
  });

  const memoryModelItems: FormItemProps[] = MEMORY_MODEL_ITEMS.map(({ contextLimit, key }) => {
    const value = systemAgentSettings[key];

    return {
      children: (
        <Flexbox direction="vertical" gap={8} style={{ width: 448 }}>
          <ModelSelect
            showAbility={false}
            style={{ minWidth: 0, width: '100%' }}
            value={value}
            onChange={(props) => updateSystemAgentModel(key, props)}
          />
          {contextLimit && (
            <ConfigProvider theme={{ token: { controlHeight: 32 } }}>
              <InputNumber
                min={1}
                placeholder={t('serviceModel.contextLimit.placeholder')}
                style={{ alignSelf: 'flex-end', width: 180 }}
                value={value.contextLimit}
                onChange={(contextLimit) =>
                  updateSystemAgentModel(key, {
                    contextLimit: typeof contextLimit === 'number' ? contextLimit : undefined,
                  })
                }
              />
            </ConfigProvider>
          )}
        </Flexbox>
      ),
      desc: t(`systemAgent.${key}.modelDesc`),
      label: t(`systemAgent.${key}.title`),
    } satisfies FormItemProps;
  });

  const optionalFeatureItems: FormItemProps[] = OPTIONAL_FEATURE_ITEMS.map(({ key }) => {
    const value = systemAgentSettings[key];
    const featureDisabled = value.enabled === false;

    return {
      children: (
        <Tooltip title={reason}>
          <Flexbox
            align="center"
            direction="horizontal"
            gap={12}
            style={{ width: 'min(100%, 448px)' }}
          >
            <ModelSelect
              disabled={!canManageServiceModel}
              showAbility={false}
              style={{ minWidth: 0, width: '100%' }}
              value={value}
              onChange={(props) => updateSystemAgentModel(key, props)}
            />
            <Flexbox align="center" direction="horizontal" gap={8}>
              <Switch
                aria-label={t(`systemAgent.${key}.title`)}
                checked={value.enabled}
                disabled={!canManageServiceModel}
                loading={loadingKey === key}
                onChange={(enabled) => updateSystemAgentModel(key, { enabled })}
              />
            </Flexbox>
          </Flexbox>
        </Tooltip>
      ),
      desc: t(`systemAgent.${key}.modelDesc`),
      label: (
        <span
          style={{
            opacity: featureDisabled || !canManageServiceModel ? 0.45 : 1,
          }}
        >
          {t(`systemAgent.${key}.title`)}
        </span>
      ),
    } satisfies FormItemProps;
  });

  const isOptionalFeatureLoading =
    loadingKey === 'followUpAction' ||
    loadingKey === 'inputCompletion' ||
    loadingKey === 'promptRewrite';
  const isMemoryModelLoading = MEMORY_MODEL_ITEMS.some(({ key }) => loadingKey === key);
  const isModelAssignmentLoading = loadingKey && !isOptionalFeatureLoading && !isMemoryModelLoading;

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

  const memoryModels: FormGroupItemType = {
    children: memoryModelItems,
    extra: isMemoryModelLoading && (
      <Icon spin icon={Loader2Icon} size={16} style={{ opacity: 0.5 }} />
    ),
    title: t('serviceModel.memoryModels.title'),
  };

  return (
    <Form
      collapsible={false}
      items={[modelAssignments, memoryModels, optionalFeatures]}
      itemsType={'group'}
      variant={'filled'}
      {...FORM_STYLE}
      itemMinWidth={undefined}
    />
  );
});

ModelAssignmentsForm.displayName = 'ModelAssignmentsForm';

export default ModelAssignmentsForm;
