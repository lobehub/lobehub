'use client';

import type { FormGroupItemType, FormItemProps } from '@lobehub/ui';
import { Flexbox, Form, InputNumber, Skeleton, TextArea, Tooltip } from '@lobehub/ui';
import { Switch } from '@lobehub/ui/base-ui';
import isEqual from 'fast-deep-equal';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import AutoSaveHint from '@/components/Editor/AutoSaveHint';
import { FORM_STYLE } from '@/const/layoutTokens';
import ModelSelect from '@/features/ModelSelect';
import { SettingsSearchAnchor } from '@/features/SettingsSearch/anchor';
import { usePermission } from '@/hooks/usePermission';
import { useSaveState } from '@/hooks/useSaveState';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';
import type { SystemAgentItem, UserServiceModelConfigKey } from '@/types/user/settings';

import { serviceModelFormStyles as styles } from './styles';

type ModelAssignmentItemKey = Exclude<
  UserServiceModelConfigKey,
  'onboardingTaskRecommender' | 'onboardingUnderstanding'
>;

interface SystemAgentModelItem {
  contextLimit?: boolean;
  key: ModelAssignmentItemKey;
  modelType?: 'chat' | 'embedding';
}

type LoadingKey = 'defaultAgent' | UserServiceModelConfigKey;

type SavingGroup = 'assignments' | 'memory' | 'optional';

const SYSTEM_AGENT_MODEL_ITEMS: SystemAgentModelItem[] = [
  { key: 'expertise' },
  { key: 'goal' },
  { key: 'topic' },
  { key: 'generationTopic' },
  { key: 'translation' },
  { key: 'historyCompress' },
  { key: 'agentMeta' },
];

const OPTIONAL_FEATURE_ITEMS: SystemAgentModelItem[] = [
  { key: 'topicAutoSummary' },
  { key: 'followUpAction' },
  { key: 'inputCompletion' },
  { key: 'promptRewrite' },
];

const MEMORY_MODEL_ITEMS: SystemAgentModelItem[] = [
  { contextLimit: true, key: 'memoryAnalysisAgentConfig' },
  { contextLimit: true, key: 'userMemoryPersonaWriter' },
  { contextLimit: true, key: 'userMemoryEmbedding', modelType: 'embedding' },
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
  // Track which group last saved so its AutoSaveHint (and only its) reflects the
  // shared save-state — the write-side counterpart to the read-side AsyncError above.
  const [savingGroup, setSavingGroup] = useState<SavingGroup>();
  const { status: saveStatus, lastSavedAt, save, retry } = useSaveState();

  useEffect(() => {
    if (loadingKey === 'defaultAgent') setLoadingKey(undefined);
  }, [defaultAgent.config.model, defaultAgent.config.provider, loadingKey]);

  const groupOfKey = (key: UserServiceModelConfigKey): SavingGroup => {
    if (MEMORY_MODEL_ITEMS.some((item) => item.key === key)) return 'memory';
    if (OPTIONAL_FEATURE_ITEMS.some((item) => item.key === key)) return 'optional';
    return 'assignments';
  };

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

    setSavingGroup('assignments');
    setLoadingKey('defaultAgent');
    try {
      await save(() => updateDefaultAgent({ config: { model, provider } }));
    } finally {
      setLoadingKey(undefined);
    }
  };

  const updateSystemAgentModel = async (
    key: UserServiceModelConfigKey,
    value: Partial<SystemAgentItem>,
  ) => {
    if (!canManageServiceModel) return;

    setSavingGroup(groupOfKey(key));
    setLoadingKey(key);
    try {
      await save(() => updateSystemAgent(key, value));
    } finally {
      setLoadingKey(undefined);
    }
  };

  const defaultAgentItem: FormItemProps = {
    className: styles.centeredLabel,
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
    // No `desc` here or on the rows below: in Model Assignments the label plus
    // the picker already say what the row does, and a line of prose per row
    // just pushes the list apart. The other groups keep theirs.
    label: t('defaultAgent.title'),
  };

  const systemModelItems: FormItemProps[] = SYSTEM_AGENT_MODEL_ITEMS.map(({ key }) => {
    const value = systemAgentSettings[key];

    return {
      className: styles.centeredLabel,
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
      label: t(`systemAgent.${key}.title`),
    } satisfies FormItemProps;
  });

  const memoryModelItems: FormItemProps[] = MEMORY_MODEL_ITEMS.map(
    ({ contextLimit, key, modelType }) => {
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
              modelType={modelType}
              showAbility={false}
              style={{ minWidth: 0, width: '100%' }}
              value={value}
              onChange={(props) => updateSystemAgentModel(key, props)}
            />
            {contextLimit && (
              <InputNumber
                min={1}
                placeholder={t('serviceModel.contextLimit.placeholder')}
                // Sits beside the picker, so it keeps the picker's height and
                // holds its width while the picker takes the slack.
                style={{ flex: 'none', width: 140 }}
                value={value.contextLimit}
                onChange={(contextLimit) =>
                  updateSystemAgentModel(key, {
                    contextLimit: typeof contextLimit === 'number' ? contextLimit : undefined,
                  })
                }
              />
            )}
          </Flexbox>
        ),
        desc: t(`systemAgent.${key}.modelDesc`),
        label: t(`systemAgent.${key}.title`),
      } satisfies FormItemProps;
    },
  );

  const optionalFeatureItems: FormItemProps[] = OPTIONAL_FEATURE_ITEMS.map(({ key }) => {
    const value = systemAgentSettings[key];
    const featureDisabled = value.enabled === false;

    return {
      children: (
        <Tooltip title={reason}>
          <Flexbox gap={12} style={{ width: 'min(100%, 448px)' }}>
            <Flexbox align="center" direction="horizontal" gap={12} justify="flex-end">
              {/* Which model runs a feature is only worth asking once the feature
                itself is on — off, the picker is a dead control, so the switch
                stands alone until it's flipped back. */}
              {!featureDisabled && (
                <ModelSelect
                  disabled={!canManageServiceModel}
                  showAbility={false}
                  style={{ minWidth: 0, width: '100%' }}
                  value={value}
                  onChange={(props) => updateSystemAgentModel(key, props)}
                />
              )}
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
            {key === 'topicAutoSummary' && !featureDisabled && (
              <TextArea
                autoSize={{ maxRows: 8, minRows: 3 }}
                defaultValue={value.customPrompt}
                disabled={!canManageServiceModel}
                placeholder={t('systemAgent.topicAutoSummary.promptPlaceholder')}
                onBlur={(event) =>
                  updateSystemAgentModel(key, { customPrompt: event.currentTarget.value.trim() })
                }
              />
            )}
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

  const renderSaveHint = (group: SavingGroup) =>
    savingGroup === group && (
      <AutoSaveHint lastUpdatedTime={lastSavedAt} saveStatus={saveStatus} onRetry={retry} />
    );

  const modelAssignments: FormGroupItemType = {
    children: [defaultAgentItem, ...systemModelItems],
    extra: renderSaveHint('assignments'),
    title: (
      <SettingsSearchAnchor id={'service-model-assignments'}>
        {t('serviceModel.modelAssignments.title')}
      </SettingsSearchAnchor>
    ),
  };

  const optionalFeatures: FormGroupItemType = {
    children: optionalFeatureItems,
    extra: renderSaveHint('optional'),
    title: (
      <SettingsSearchAnchor id={'service-model-optional-features'}>
        {t('serviceModel.optionalFeatures.title')}
      </SettingsSearchAnchor>
    ),
  };

  const memoryModels: FormGroupItemType = {
    children: memoryModelItems,
    extra: renderSaveHint('memory'),
    title: (
      <SettingsSearchAnchor id={'service-model-memory'}>
        {t('serviceModel.memoryModels.title')}
      </SettingsSearchAnchor>
    ),
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
