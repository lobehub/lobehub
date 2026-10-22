'use client';

import { SERVICE_MODEL_TIER_SLOTS } from '@lobechat/const';
import { Button, Divider, Flexbox, Icon, InputNumber, TextArea } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import isEqual from 'fast-deep-equal';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import AsyncError from '@/components/AsyncError';
import AutoSaveHint from '@/components/Editor/AutoSaveHint';
import { RouteLoading } from '@/components/Skeleton/RouteSegment';
import { SETTINGS_ANCHOR_ROW_ATTR, SettingsSearchAnchor } from '@/features/SettingsSearch/anchor';
import { usePermission } from '@/hooks/usePermission';
import { useSaveState } from '@/hooks/useSaveState';
import { useUserStore } from '@/store/user';
import {
  PERSONAL_SYSTEM_AGENT_KEYS,
  type ServiceModelTier,
  type SystemAgentItem,
  type UserServiceModelConfigKey,
} from '@/types/user/settings';

import {
  applySlotChoice,
  applyTierChoice,
  canDisableSlot,
  getTierItem,
  type ModelRef,
  resolveFollowModel,
  resolveSlotState,
  restoreAllSlots,
  type SlotChoice,
  type StoredSystemAgent,
} from '../serviceModelState';
import SlotRow, { type RowState } from './SlotRow';
import { PICKER_WIDTH, styles } from './styles';
import TierRow from './TierRow';
import { type ModelKind } from './useModelCatalog';

/** The model new agents start with; it lives in `defaultAgent`, not in `systemAgent`. */
const DEFAULT_AGENT_ROW = 'defaultAgent';

const ADVANCED_ANCHOR = 'service-model-advanced';

/** Onboarding and channel-routing slots are internal and not shown. */
type DisplaySlot = Exclude<
  UserServiceModelConfigKey,
  'channelRouting' | 'onboardingTaskRecommender' | 'onboardingUnderstanding'
>;

type RowKey = typeof DEFAULT_AGENT_ROW | DisplaySlot;

// lobe-design-ignore DETAIL-NO-EMPTY: the groups and rows are a fixed list; a group left empty (personal rows hidden in a workspace) is filtered out
/** 「高级」 is grouped by what the task is for, not by the model it follows. */
const GROUPS: { key: string; rows: RowKey[] }[] = [
  { key: 'agent', rows: [DEFAULT_AGENT_ROW, 'agentMeta', 'expertise', 'goal'] },
  { key: 'topic', rows: ['topic', 'thread', 'generationTopic', 'topicAutoSummary'] },
  { key: 'content', rows: ['translation', 'historyCompress', 'promptRewrite'] },
  {
    key: 'memory',
    rows: ['memoryAnalysisAgentConfig', 'userMemoryPersonaWriter', 'userMemoryEmbedding'],
  },
  { key: 'suggestion', rows: ['inputCompletion', 'followUpAction'] },
  { key: 'voice', rows: ['asr'] },
];

const TIERS: { key: ServiceModelTier; modelKind: ModelKind }[] = [
  { key: 'main', modelKind: 'chat' },
  { key: 'flash', modelKind: 'chat' },
  { key: 'embedding', modelKind: 'embedding' },
];

const MEMORY_CONTEXT_LIMIT_SLOTS = new Set<RowKey>([
  'memoryAnalysisAgentConfig',
  'userMemoryEmbedding',
  'userMemoryPersonaWriter',
]);

const modelKindOf = (row: RowKey): ModelKind =>
  row === 'userMemoryEmbedding' ? 'embedding' : row === 'asr' ? 'asr' : 'chat';

const PERSONAL_SLOTS = new Set<UserServiceModelConfigKey>(PERSONAL_SYSTEM_AGENT_KEYS);
const NO_SLOTS = new Set<UserServiceModelConfigKey>();

interface ServiceModelFormProps {
  /**
   * Drop the personal chat-assist rows (follow-up, input completion). The
   * workspace surface edits them on its own Chat Preferences tab instead.
   */
  hidePersonalPreferences?: boolean;
}

const ServiceModelForm = ({ hidePersonalPreferences }: ServiceModelFormProps) => {
  const { t } = useTranslation('setting');
  const { allowed: canManage, reason } = usePermission('manage_settings');
  const [storedSystemAgent, storedDefaultAgent, defaults, defaultAgentDefaults] = useUserStore(
    (s) => [
      s.settings.systemAgent as StoredSystemAgent | undefined,
      s.settings.defaultAgent,
      s.defaultSettings.systemAgent,
      s.defaultSettings.defaultAgent?.config,
    ],
    isEqual,
  );
  const [replaceServiceModelSettings, isUserStateInit, isUserStateInitError, refreshUserState] =
    useUserStore((s) => [
      s.replaceServiceModelSettings,
      s.isUserStateInit,
      s.isUserStateInitError,
      s.refreshUserState,
    ]);
  // A settings-search deep link to 「高级」 lands on it opened.
  const { hash } = useLocation();
  const [expanded, setExpanded] = useState(() => hash === `#${ADVANCED_ANCHOR}`);
  const { status: saveStatus, lastSavedAt, save, retry } = useSaveState();

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

  const skipSlots = hidePersonalPreferences ? PERSONAL_SLOTS : NO_SLOTS;
  const groups = GROUPS.map((group) => ({
    ...group,
    rows: group.rows.filter(
      (row) => row === DEFAULT_AGENT_ROW || !skipSlots.has(row as UserServiceModelConfigKey),
    ),
  })).filter((group) => group.rows.length > 0);
  const slotRows = groups
    .flatMap((group) => group.rows)
    .filter((row): row is DisplaySlot => row !== DEFAULT_AGENT_ROW);
  const rows: RowKey[] = [DEFAULT_AGENT_ROW, ...slotRows];

  const pinnedDefaultAgent: ModelRef | undefined =
    storedDefaultAgent?.config?.model && storedDefaultAgent.config.provider
      ? { model: storedDefaultAgent.config.model, provider: storedDefaultAgent.config.provider }
      : undefined;

  const rowState = (row: RowKey): RowState => {
    if (row === DEFAULT_AGENT_ROW)
      return pinnedDefaultAgent
        ? { kind: 'custom', value: pinnedDefaultAgent }
        : { kind: 'follow' };

    const state = resolveSlotState(storedSystemAgent, defaults, row);
    return state.kind === 'custom' ? state : { kind: state.kind };
  };

  const states = rows.map(rowState);
  const customCount = states.filter((state) => state.kind === 'custom').length;
  const offCount = states.filter((state) => state.kind === 'off').length;

  const write = (columns: Parameters<typeof replaceServiceModelSettings>[0]) =>
    save(() => replaceServiceModelSettings(columns));

  const writeSlot = (row: RowKey, choice: SlotChoice) => {
    if (row !== DEFAULT_AGENT_ROW) {
      write({ systemAgent: applySlotChoice(storedSystemAgent, row, choice, { skipSlots }) });
      return;
    }

    // Following drops the pin, so new agents pick up the system default again.
    const config = { ...storedDefaultAgent?.config };
    delete config.model;
    delete config.provider;
    if (choice.kind === 'custom') Object.assign(config, choice.value);
    write({ defaultAgent: { ...storedDefaultAgent, config } });
  };

  const writeSlotField = (slot: UserServiceModelConfigKey, patch: Partial<SystemAgentItem>) =>
    write({
      systemAgent: {
        ...storedSystemAgent,
        [slot]: { ...(storedSystemAgent?.[slot] as Partial<SystemAgentItem>), ...patch },
      },
    });

  const restoreAll = () => {
    const columns: Parameters<typeof replaceServiceModelSettings>[0] = {
      systemAgent: restoreAllSlots(storedSystemAgent, defaults, slotRows, {
        skipSlots,
      }),
    };
    if (pinnedDefaultAgent) {
      const config = { ...storedDefaultAgent?.config };
      delete config.model;
      delete config.provider;
      columns.defaultAgent = { ...storedDefaultAgent, config };
    }
    write(columns);
  };

  const followLabelOf = (row: RowKey) => {
    if (row === DEFAULT_AGENT_ROW || row === 'asr') return t('serviceModel.systemRecommended');
    const tier = TIERS.find(({ key }) => SERVICE_MODEL_TIER_SLOTS[key].includes(row));
    return tier ? t(`serviceModel.tier.${tier.key}.title`) : t('serviceModel.systemRecommended');
  };

  const followModelOf = (row: RowKey): ModelRef | undefined => {
    if (row !== DEFAULT_AGENT_ROW) return resolveFollowModel(storedSystemAgent, defaults, row);
    return defaultAgentDefaults?.model && defaultAgentDefaults.provider
      ? { model: defaultAgentDefaults.model, provider: defaultAgentDefaults.provider }
      : undefined;
  };

  const renderExtra = (row: RowKey, state: RowState) => {
    if (row === 'topicAutoSummary' && state.kind !== 'off') {
      const value = storedSystemAgent?.topicAutoSummary?.customPrompt;
      return (
        <TextArea
          autoSize={{ maxRows: 8, minRows: 3 }}
          defaultValue={value}
          disabled={!canManage}
          placeholder={t('systemAgent.topicAutoSummary.promptPlaceholder')}
          style={{ marginBlock: 4 }}
          onBlur={(event) => {
            const customPrompt = event.currentTarget.value.trim();
            if (customPrompt !== (value ?? ''))
              writeSlotField('topicAutoSummary', { customPrompt });
          }}
        />
      );
    }

    // A context limit only matters for a model the user picked; the system
    // default brings its own. Keep showing a limit that is already set.
    const contextLimit = (
      storedSystemAgent?.[row as UserServiceModelConfigKey] as Partial<SystemAgentItem> | undefined
    )?.contextLimit;
    if (MEMORY_CONTEXT_LIMIT_SLOTS.has(row) && (state.kind === 'custom' || contextLimit)) {
      return (
        <Flexbox
          horizontal
          align={'center'}
          gap={24}
          justify={'space-between'}
          {...stylex.props(styles.row)}
        >
          <span {...stylex.props(styles.secondaryText)}>
            {t('serviceModel.contextLimit.placeholder')}
          </span>
          <InputNumber
            aria-label={t('serviceModel.contextLimit.placeholder')}
            disabled={!canManage}
            min={1}
            style={{ flex: 'none', width: PICKER_WIDTH }}
            value={contextLimit}
            variant={'filled'}
            onChange={(next) =>
              writeSlotField(row as UserServiceModelConfigKey, {
                contextLimit: typeof next === 'number' ? next : undefined,
              })
            }
          />
        </Flexbox>
      );
    }
  };

  const summary = [
    t('serviceModel.advanced.summary.total', { count: states.length }),
    customCount > 0 && t('serviceModel.advanced.summary.custom', { count: customCount }),
    offCount > 0 && t('serviceModel.advanced.summary.off', { count: offCount }),
    t('serviceModel.advanced.summary.rest'),
  ]
    .filter(Boolean)
    .join(t('serviceModel.advanced.summary.separator'));

  return (
    <Flexbox gap={24}>
      <Flexbox horizontal align={'flex-start'} gap={24} justify={'space-between'}>
        <Flexbox gap={4}>
          <span {...stylex.props(styles.secondaryText)}>{t('serviceModel.desc')}</span>
          {/* Shown, not hovered: the pickers are disabled and mobile has no hover. */}
          {!canManage && reason && <span {...stylex.props(styles.desc)}>{reason}</span>}
        </Flexbox>
        {saveStatus !== 'idle' && (
          <AutoSaveHint
            lastUpdatedTime={lastSavedAt}
            saveStatus={saveStatus}
            style={{ flex: 'none' }}
            onRetry={retry}
          />
        )}
      </Flexbox>

      <Flexbox gap={20} {...{ [SETTINGS_ANCHOR_ROW_ATTR]: '' }}>
        {TIERS.map(({ key, modelKind }, index) => (
          <TierRow
            anchor={index === 0 ? 'service-model-assignments' : undefined}
            desc={t(`serviceModel.tier.${key}.desc`)}
            disabled={!canManage}
            key={key}
            modelKind={modelKind}
            recommended={resolveFollowModel({}, defaults, SERVICE_MODEL_TIER_SLOTS[key][0])!}
            title={t(`serviceModel.tier.${key}.title`)}
            value={getTierItem(storedSystemAgent, key)}
            onChange={(value) =>
              write({
                systemAgent: applyTierChoice(storedSystemAgent, key, value, { skipSlots }),
              })
            }
          />
        ))}
      </Flexbox>

      <Divider style={{ margin: 0 }} />

      <Flexbox gap={expanded ? 20 : 0}>
        <Flexbox
          horizontal
          align={'center'}
          gap={24}
          justify={'space-between'}
          {...{ [SETTINGS_ANCHOR_ROW_ATTR]: '' }}
        >
          <Flexbox gap={2} style={{ minWidth: 0 }}>
            <SettingsSearchAnchor id={ADVANCED_ANCHOR}>
              <span {...stylex.props(styles.label)}>{t('serviceModel.advanced.title')}</span>
            </SettingsSearchAnchor>
            <span {...stylex.props(styles.desc)}>{summary}</span>
          </Flexbox>
          {/* The end margin puts the 收起 arrow on the same line as the picker arrows. */}
          <Flexbox horizontal align={'center'} gap={4} style={{ flex: 'none', marginInlineEnd: 2 }}>
            {customCount > 0 && (
              <Button disabled={!canManage} size={'small'} type={'text'} onClick={restoreAll}>
                {t('serviceModel.advanced.restoreAll')}
              </Button>
            )}
            <Button
              aria-expanded={expanded}
              icon={<Icon icon={expanded ? ChevronUp : ChevronDown} />}
              iconPosition={'end'}
              size={'small'}
              type={'text'}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? t('serviceModel.advanced.collapse') : t('serviceModel.advanced.expand')}
            </Button>
          </Flexbox>
        </Flexbox>

        {expanded && (
          <Flexbox gap={20}>
            {groups.map((group) => (
              <Flexbox gap={4} key={group.key}>
                <span {...stylex.props(styles.groupTitle)}>
                  {t(`serviceModel.group.${group.key}` as 'serviceModel.group.agent')}
                </span>
                <Flexbox>
                  {group.rows.map((row) => {
                    const state = rowState(row);
                    const title =
                      row === DEFAULT_AGENT_ROW
                        ? t('defaultAgent.title')
                        : t(`systemAgent.${row}.title`);

                    return (
                      <SlotRow
                        canDisable={row !== DEFAULT_AGENT_ROW && canDisableSlot(row)}
                        disabled={!canManage}
                        followLabel={followLabelOf(row)}
                        followModel={followModelOf(row)}
                        key={row}
                        modelKind={modelKindOf(row)}
                        state={state}
                        title={title}
                        onChange={(choice) => writeSlot(row, choice)}
                      >
                        {renderExtra(row, state)}
                      </SlotRow>
                    );
                  })}
                </Flexbox>
              </Flexbox>
            ))}
          </Flexbox>
        )}
      </Flexbox>
    </Flexbox>
  );
};

export default ServiceModelForm;
