'use client';

import { SERVICE_MODEL_TIER_SLOTS } from '@lobechat/const';
import { Button, Flexbox, Icon, InputNumber, Switch, TextArea } from '@lobehub/ui';
import { Form, type FormGroupItem, useForm } from '@lobehub/ui/form';
import * as stylex from '@stylexjs/stylex';
import isEqual from 'fast-deep-equal';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import AsyncError from '@/components/AsyncError';
import AutoSaveHint from '@/components/Editor/AutoSaveHint';
import { RouteLoading } from '@/components/Skeleton/RouteSegment';
import { FORM_STYLE } from '@/const/layoutTokens';
import { SettingsSearchAnchor } from '@/features/SettingsSearch/anchor';
import { usePermission } from '@/hooks/usePermission';
import { useSaveState } from '@/hooks/useSaveState';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
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
  tierOfSlot,
} from '../serviceModelState';
import SlotRow, { type RowState } from './SlotRow';
import { PICKER_WIDTH, styles } from './styles';
import TierRow from './TierRow';
import { type ModelKind } from './useModelCatalog';

/** The model new agents start with; it lives in `defaultAgent`, not in `systemAgent`. */
const DEFAULT_AGENT_ROW = 'defaultAgent';

const ADVANCED_ANCHOR = 'service-model-advanced';

/** Onboarding slots are internal and not shown. */
type DisplaySlot = Exclude<
  UserServiceModelConfigKey,
  'onboardingTaskRecommender' | 'onboardingUnderstanding'
>;

type RowKey = typeof DEFAULT_AGENT_ROW | DisplaySlot;

/**
 * Each tier is a top-level picker with the tasks that follow it folded under
 * it. 新建助理 lives in `defaultAgent`, not in a tier, but reads as a main-model
 * task. A tier with a single task needs no 「高级」: the tier is that task.
 */
const TIERS: { key: ServiceModelTier; modelKind: ModelKind; rows: RowKey[] }[] = [
  { key: 'main', modelKind: 'chat', rows: [DEFAULT_AGENT_ROW, ...SERVICE_MODEL_TIER_SLOTS.main] },
  { key: 'flash', modelKind: 'chat', rows: SERVICE_MODEL_TIER_SLOTS.flash },
  // The verifier reads screenshot evidence; a text-only model cannot judge it.
  { key: 'verify', modelKind: 'vision', rows: SERVICE_MODEL_TIER_SLOTS.verify },
  { key: 'embedding', modelKind: 'embedding', rows: SERVICE_MODEL_TIER_SLOTS.embedding },
] as { key: ServiceModelTier; modelKind: ModelKind; rows: RowKey[] }[];

/** Speech-to-text follows no tier; it is its own row after the tiers. */
const ASR_ROW = 'asr' satisfies RowKey;

/** A settings card: one per tier, plus voice. */
type Section = ServiceModelTier | 'channelRouting' | 'voice';

const sectionOf = (row: RowKey | UserServiceModelConfigKey): Section => {
  if (row === DEFAULT_AGENT_ROW) return 'main';
  if (row === ASR_ROW) return 'voice';
  if (row === 'channelRouting') return 'channelRouting';
  return tierOfSlot(row) ?? 'main';
};

const MEMORY_CONTEXT_LIMIT_SLOTS = new Set<RowKey>([
  'memoryAnalysisAgentConfig',
  'userMemoryEmbedding',
  'userMemoryPersonaWriter',
]);

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
  const enableChannels = useServerConfigStore(serverConfigSelectors.enableChannels);
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
  // A settings-search deep link to 「高级」 lands on every tier's list opened.
  const { hash } = useLocation();
  const [expanded, setExpanded] = useState<ReadonlySet<ServiceModelTier>>(
    () => new Set(hash === `#${ADVANCED_ANCHOR}` ? TIERS.map(({ key }) => key) : []),
  );
  const { status: saveStatus, lastSavedAt, save, retry } = useSaveState();
  const [savingSection, setSavingSection] = useState<Section>();
  const form = useForm();

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
  const tiers = TIERS.map((tier) => ({
    ...tier,
    rows: tier.rows.filter(
      (row) => row === DEFAULT_AGENT_ROW || !skipSlots.has(row as UserServiceModelConfigKey),
    ),
  }));

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

  /** Saves and remembers which card changed, so only that card shows the save hint. */
  const write = (section: Section, columns: Parameters<typeof replaceServiceModelSettings>[0]) => {
    setSavingSection(section);
    return save(() => replaceServiceModelSettings(columns));
  };

  const writeSlot = (row: RowKey, choice: SlotChoice) => {
    if (row !== DEFAULT_AGENT_ROW) {
      write(sectionOf(row), {
        systemAgent: applySlotChoice(storedSystemAgent, row, choice, { skipSlots }),
      });
      return;
    }

    // Following drops the pin, so new agents pick up the system default again.
    const config = { ...storedDefaultAgent?.config };
    delete config.model;
    delete config.provider;
    if (choice.kind === 'custom') Object.assign(config, choice.value);
    write('main', { defaultAgent: { ...storedDefaultAgent, config } });
  };

  const writeSlotField = (slot: UserServiceModelConfigKey, patch: Partial<SystemAgentItem>) =>
    write(sectionOf(slot), {
      systemAgent: {
        ...storedSystemAgent,
        [slot]: { ...(storedSystemAgent?.[slot] as Partial<SystemAgentItem>), ...patch },
      },
    });

  /** 「全部恢复」 for one tier: its pinned tasks follow the tier again; disabled ones stay off. */
  const restoreTier = (section: ServiceModelTier, rows: RowKey[]) => {
    const slots = rows.filter((row): row is DisplaySlot => row !== DEFAULT_AGENT_ROW);
    const columns: Parameters<typeof replaceServiceModelSettings>[0] = {
      systemAgent: restoreAllSlots(storedSystemAgent, defaults, slots, { skipSlots }),
    };
    if (pinnedDefaultAgent && rows.includes(DEFAULT_AGENT_ROW)) {
      const config = { ...storedDefaultAgent?.config };
      delete config.model;
      delete config.provider;
      columns.defaultAgent = { ...storedDefaultAgent, config };
    }
    write(section, columns);
  };

  const followLabelOf = (row: RowKey) => {
    if (row === DEFAULT_AGENT_ROW || row === ASR_ROW) return t('serviceModel.systemRecommended');
    const tier = TIERS.find(({ key }) => SERVICE_MODEL_TIER_SLOTS[key].includes(row));
    return tier ? t(`serviceModel.tier.${tier.key}.title`) : t('serviceModel.systemRecommended');
  };

  const renderRow = (row: RowKey, modelKind: ModelKind) => {
    const state = rowState(row);
    const title =
      row === DEFAULT_AGENT_ROW ? t('defaultAgent.title') : t(`systemAgent.${row}.title`);

    return (
      <Flexbox key={row}>
        <Flexbox
          horizontal
          align={'center'}
          gap={24}
          justify={'space-between'}
          {...stylex.props(styles.row)}
        >
          <span {...stylex.props(state.kind === 'off' ? styles.taskNameOff : styles.taskName)}>
            {title}
          </span>
          <SlotRow
            canDisable={row !== DEFAULT_AGENT_ROW && canDisableSlot(row)}
            disabled={!canManage}
            followLabel={followLabelOf(row)}
            followModel={followModelOf(row)}
            modelKind={modelKind}
            state={state}
            title={title}
            onChange={(choice) => writeSlot(row, choice)}
          />
        </Flexbox>
        {renderExtra(row, state)}
      </Flexbox>
    );
  };

  /** A tier's own 「高级」: the tasks that follow it, folded under its picker. */
  const renderAdvanced = (key: ServiceModelTier, modelKind: ModelKind, rows: RowKey[]) => {
    const states = rows.map(rowState);
    const customCount = states.filter((state) => state.kind === 'custom').length;
    const offCount = states.filter((state) => state.kind === 'off').length;
    const open = expanded.has(key);
    const summary = [
      t('serviceModel.advanced.summary.total', { count: rows.length }),
      customCount > 0 && t('serviceModel.advanced.summary.custom', { count: customCount }),
      offCount > 0 && t('serviceModel.advanced.summary.off', { count: offCount }),
      t('serviceModel.advanced.summary.followTier', {
        tier: t(`serviceModel.tier.${key}.title`),
      }),
    ]
      .filter(Boolean)
      .join(t('serviceModel.advanced.summary.separator'));
    const toggle = () => {
      const next = new Set(expanded);
      if (open) next.delete(key);
      else next.add(key);
      setExpanded(next);
    };
    const heading = (
      <span {...stylex.props(styles.sectionTitle)}>{t('serviceModel.advanced.title')}</span>
    );

    return (
      <Flexbox {...stylex.props(styles.advanced)}>
        <Flexbox horizontal align={'center'} gap={24} justify={'space-between'}>
          <Flexbox horizontal align={'baseline'} gap={8} style={{ minWidth: 0 }}>
            {key === 'main' ? (
              <SettingsSearchAnchor id={ADVANCED_ANCHOR}>{heading}</SettingsSearchAnchor>
            ) : (
              heading
            )}
            <span {...stylex.props(styles.sectionDesc)}>{summary}</span>
          </Flexbox>
          <Flexbox horizontal align={'center'} gap={4} style={{ flex: 'none' }}>
            {customCount > 0 && (
              <Button
                disabled={!canManage}
                size={'small'}
                type={'text'}
                onClick={() => restoreTier(key, rows)}
              >
                {t('serviceModel.advanced.restoreAll')}
              </Button>
            )}
            <Button
              aria-expanded={open}
              icon={<Icon icon={open ? ChevronUp : ChevronDown} />}
              iconPosition={'end'}
              size={'small'}
              type={'text'}
              onClick={toggle}
            >
              {open ? t('serviceModel.advanced.collapse') : t('serviceModel.advanced.expand')}
            </Button>
          </Flexbox>
        </Flexbox>
        {open && (
          <Flexbox style={{ paddingBlockStart: 8 }}>
            {rows.map((row) => renderRow(row, modelKind))}
          </Flexbox>
        )}
      </Flexbox>
    );
  };

  const followModelOf = (row: RowKey): ModelRef | undefined => {
    if (row !== DEFAULT_AGENT_ROW) return resolveFollowModel(storedSystemAgent, defaults, row);
    return defaultAgentDefaults?.model && defaultAgentDefaults.provider
      ? { model: defaultAgentDefaults.model, provider: defaultAgentDefaults.provider }
      : undefined;
  };

  /** Row-level controls that only exist for some rows (a custom prompt, a context limit). */
  const renderExtra = (row: RowKey, state: RowState) => {
    if (row === 'topicAutoSummary' && state.kind !== 'off') {
      const value = storedSystemAgent?.topicAutoSummary?.customPrompt;
      return (
        <TextArea
          autoSize={{ maxRows: 8, minRows: 3 }}
          defaultValue={value}
          disabled={!canManage}
          placeholder={t('systemAgent.topicAutoSummary.promptPlaceholder')}
          style={{ marginBlockEnd: 8, width: '100%' }}
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
          style={{ minHeight: 40 }}
        >
          <span {...stylex.props(styles.taskNameOff)}>
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

  // One settings group per page. Each tier is a form row; its 「高级」 is a
  // lighter sub-section right under it — small type, compact 40px rows — so the
  // tasks read as details of the tier they follow.
  const saveHint = (section: Section) =>
    saveStatus === 'idle' || savingSection !== section ? undefined : (
      <AutoSaveHint lastUpdatedTime={lastSavedAt} saveStatus={saveStatus} onRetry={retry} />
    );
  const withReason = (desc: string) => (!canManage && reason ? `${desc} ${reason}` : desc);

  // One settings group per model kind, like 生图 below: each tier is its own
  // card with its picker on top and the tasks that follow it in a lighter
  // 「高级」 under it. Voice follows no tier, so it is a card of its own.
  const groups: FormGroupItem[] = [
    ...tiers.map(({ key, modelKind, rows }, index): FormGroupItem => {
      const title = t(`serviceModel.tier.${key}.title`);
      return {
        children: (
          <>
            <Form.Field label={t('serviceModel.tierPicker')}>
              <TierRow
                disabled={!canManage}
                modelKind={modelKind}
                recommended={resolveFollowModel({}, defaults, SERVICE_MODEL_TIER_SLOTS[key][0])!}
                title={title}
                value={getTierItem(storedSystemAgent, key)}
                onChange={(value) =>
                  write(key, {
                    systemAgent: applyTierChoice(storedSystemAgent, key, value, { skipSlots }),
                  })
                }
              />
            </Form.Field>
            {rows.length > 1 && renderAdvanced(key, modelKind, rows)}
          </>
        ),
        collapsible: false,
        desc: withReason(t(`serviceModel.tier.${key}.desc`)),
        extra: saveHint(key),
        title: (
          <SettingsSearchAnchor
            id={index === 0 ? 'service-model-assignments' : `service-model-${key}`}
          >
            {title}
          </SettingsSearchAnchor>
        ),
      };
    }),
    {
      children: (
        <Form.Field
          label={
            <SettingsSearchAnchor id={`service-model-${ASR_ROW}`}>
              {t(`systemAgent.${ASR_ROW}.title`)}
            </SettingsSearchAnchor>
          }
        >
          <SlotRow
            canDisable
            disabled={!canManage}
            followLabel={followLabelOf(ASR_ROW)}
            followModel={followModelOf(ASR_ROW)}
            modelKind={'asr'}
            state={rowState(ASR_ROW)}
            title={t(`systemAgent.${ASR_ROW}.title`)}
            onChange={(choice) => writeSlot(ASR_ROW, choice)}
          />
        </Form.Field>
      ),
      collapsible: false,
      desc: withReason(t('serviceModel.voice.desc')),
      extra: saveHint('voice'),
      title: t('serviceModel.voice.title'),
    },
  ];

  if (enableChannels) {
    const row = 'channelRouting';
    const state = rowState(row);
    const title = t('systemAgent.channelRouting.title');
    groups.push({
      children: (
        <Form.Field label={t('serviceModel.tierPicker')}>
          <Flexbox
            horizontal
            align={'center'}
            gap={12}
            justify={'flex-end'}
            style={{ flex: 'none', width: PICKER_WIDTH }}
          >
            {state.kind !== 'off' && (
              <SlotRow
                canDisable={false}
                disabled={!canManage || saveStatus === 'saving'}
                followLabel={followLabelOf(row)}
                followModel={followModelOf(row)}
                modelKind={'decision'}
                state={state}
                title={title}
                width={PICKER_WIDTH - 48}
                onChange={(choice) => writeSlot(row, choice)}
              />
            )}
            <Switch
              aria-label={title}
              checked={state.kind !== 'off'}
              disabled={!canManage || saveStatus === 'saving'}
              onChange={(enabled) => writeSlotField(row, { enabled })}
            />
          </Flexbox>
        </Form.Field>
      ),
      collapsible: false,
      desc: withReason(t('systemAgent.channelRouting.modelDesc')),
      extra: saveHint(row),
      title: (
        <SettingsSearchAnchor id={'service-model-channelRouting'}>{title}</SettingsSearchAnchor>
      ),
    });
  }

  return (
    <Form
      collapsible={false}
      form={form}
      items={groups}
      itemsType={'group'}
      variant={'filled'}
      {...FORM_STYLE}
    />
  );
};

export default ServiceModelForm;
