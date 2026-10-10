'use client';

import { Flexbox, InputNumber, Switch, TextArea, Tooltip } from '@lobehub/ui';
import { Form, type FormFieldProps, type FormGroupItem, useForm } from '@lobehub/ui/form';
import isEqual from 'fast-deep-equal';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import AutoSaveHint from '@/components/Editor/AutoSaveHint';
import { RouteLoading } from '@/components/Skeleton/RouteSegment';
import { FORM_STYLE } from '@/const/layoutTokens';
import ModelSelect from '@/features/ModelSelect';
import { SettingsSearchAnchor } from '@/features/SettingsSearch/anchor';
import { usePermission } from '@/hooks/usePermission';
import { useSaveState } from '@/hooks/useSaveState';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';
import type { SystemAgentItem, UserServiceModelConfigKey } from '@/types/user/settings';

type ModelAssignmentItemKey = Exclude<
  UserServiceModelConfigKey,
  'asr' | 'onboardingTaskRecommender' | 'onboardingUnderstanding'
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
  const form = useForm();

  useEffect(() => {
    if (loadingKey === 'defaultAgent') setLoadingKey(undefined);
  }, [defaultAgent.config.model, defaultAgent.config.provider, loadingKey]);

  const groupOfKey = (key: UserServiceModelConfigKey): SavingGroup => {
    if (MEMORY_MODEL_ITEMS.some((item) => item.key === key)) return 'memory';
    if (key === 'asr' || OPTIONAL_FEATURE_ITEMS.some((item) => item.key === key)) return 'optional';
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
    return <RouteLoading />;
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

  const defaultAgentItem: FormFieldProps = {
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

  const systemModelItems: FormFieldProps[] = SYSTEM_AGENT_MODEL_ITEMS.map(({ key }) => {
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
      label: t(`systemAgent.${key}.title`),
    } satisfies FormFieldProps;
  });

  const memoryModelItems: FormFieldProps[] = MEMORY_MODEL_ITEMS.map(
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
      } satisfies FormFieldProps;
    },
  );

  const optionalFeatureItems: FormFieldProps[] = OPTIONAL_FEATURE_ITEMS.map(({ key }) => {
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
    } satisfies FormFieldProps;
  });

  const asrValue = systemAgentSettings.asr;
  const asrItem: FormFieldProps = {
    children: (
      <Tooltip title={reason}>
        <Flexbox
          align="center"
          direction="horizontal"
          gap={12}
          style={{ width: 'min(100%, 448px)' }}
        >
          <ModelSelect
            allowClear
            disabled={!canManageServiceModel}
            modelType={'asr'}
            placeholder={t('systemAgent.asr.placeholder')}
            showAbility={false}
            style={{ minWidth: 0, width: '100%' }}
            // Empty means unconfigured: render the placeholder rather than a blank selection.
            value={asrValue.model && asrValue.provider ? asrValue : undefined}
            onChange={(props) => updateSystemAgentModel('asr', props)}
            onClear={() => updateSystemAgentModel('asr', { model: '', provider: '' })}
          />
        </Flexbox>
      </Tooltip>
    ),
    desc: t('systemAgent.asr.modelDesc'),
    label: t('systemAgent.asr.title'),
  };

  const renderSaveHint = (group: SavingGroup) =>
    savingGroup === group && (
      <AutoSaveHint lastUpdatedTime={lastSavedAt} saveStatus={saveStatus} onRetry={retry} />
    );

  const modelAssignments: FormGroupItem = {
    children: [defaultAgentItem, ...systemModelItems],
    extra: renderSaveHint('assignments'),
    title: (
      <SettingsSearchAnchor id={'service-model-assignments'}>
        {t('serviceModel.modelAssignments.title')}
      </SettingsSearchAnchor>
    ),
  };

  const optionalFeatures: FormGroupItem = {
    children: [...optionalFeatureItems, asrItem],
    extra: renderSaveHint('optional'),
    title: (
      <SettingsSearchAnchor id={'service-model-optional-features'}>
        {t('serviceModel.optionalFeatures.title')}
      </SettingsSearchAnchor>
    ),
  };

  const memoryModels: FormGroupItem = {
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
      form={form}
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
