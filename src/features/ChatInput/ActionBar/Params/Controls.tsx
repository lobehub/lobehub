import {
  DEFAULT_AGENT_CONFIG,
  resolveSubAgentChatConfig,
  resolveSubAgentModel,
} from '@lobechat/const';
import { resolveEffectiveReasoningChatConfig } from '@lobechat/model-runtime/utils/modelExtendParams';
import { Flexbox, Icon, Select, SliderWithInput, Spin, Switch, TextArea } from '@lobehub/ui';
import { useForm } from '@lobehub/ui/form';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { debounce } from 'es-toolkit/compat';
import isEqual from 'fast-deep-equal';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { MODEL_REASONING_EXTEND_PARAMS } from 'model-bank/aiModel';
import type { ReactNode } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PartialDeep } from 'type-fest';

import InfoTooltip from '@/components/InfoTooltip';
import ModelSelect from '@/features/ModelSelect';
import ControlsForm from '@/features/ModelSwitchPanel/components/ControlsForm';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';
import { useUserStore } from '@/store/user';
import { systemAgentSelectors } from '@/store/user/selectors';
import type { LobeAgentChatConfig, LobeAgentConfig } from '@/types/agent';

import { useAgentId } from '../../hooks/useAgentId';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';
import { useParamsModelConfig } from './useParamsModelConfig';

interface ControlsProps {
  variant?: 'popover' | 'sidebar';
}

type ParamKey = 'temperature' | 'top_p' | 'presence_penalty' | 'frequency_penalty';

type ParamLabelKey =
  | 'settingModel.params.panel.creativity'
  | 'settingModel.params.panel.openness'
  | 'settingModel.params.panel.topicDivergence'
  | 'settingModel.params.panel.vocabularyRichness';

type ParamDescKey =
  | 'settingModel.frequencyPenalty.desc'
  | 'settingModel.presencePenalty.desc'
  | 'settingModel.temperature.desc'
  | 'settingModel.topP.desc';

interface SliderConfig {
  max: number;
  min: number;
  step: number;
  unlimitedInput?: boolean;
}

const styles = stylex.create({
  advancedContent: { display: 'flex', flexDirection: 'column' },
  sectionHeader: {
    cursor: 'pointer',
    width: 'calc(100% + 16px)',
    marginInline: '-8px',
    paddingBlock: '12px',
    paddingInline: '8px',
    borderStyle: 'none',
    borderRadius: '10px',
    fontFamily: 'inherit',
    fontStyle: 'inherit',
    fontVariant: 'inherit',
    lineHeight: 'inherit',
    fontSize: '12px',
    fontWeight: 500,
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    textAlign: 'start',
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    transition: 'color 0.2s ease',
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineWidth: { 'default': null, ':focus-visible': '1px' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorBorder },
    outlineOffset: { 'default': null, ':focus-visible': '2px' },
  },
  sectionHeaderLabel: {
    color: {
      default: cssVar.colorTextSecondary,
      [stylex.when.ancestor(':hover')]: cssVar.colorText,
    },
  },
  body: {
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    display: 'flex',
    flexGrow: '1',
    flexShrink: '1',
    flexBasis: 'auto',
    flexDirection: 'column',
    minHeight: '0',
    paddingBlockEnd: '4px',
    paddingInline: '12px',
  },
  commonSection: { display: 'flex', flexDirection: 'column', paddingBlock: '0' },
  divider: { height: '1px', backgroundColor: cssVar.colorSplit, backgroundImage: 'none' },
  hint: { fontSize: '12px', lineHeight: '18px', color: cssVar.colorTextTertiary },
  form: { margin: '0' },
  formSidebar: { display: 'flex', flex: '1', width: '100%', height: '100%', minHeight: '0' },
  header: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBlock: '16px',
    paddingInline: '12px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorSplit,
    fontSize: '14px',
    fontWeight: 600,
    lineHeight: 1.4,
    color: cssVar.colorText,
  },
  headerLoading: {
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: '18px',
    height: '18px',
    color: cssVar.colorTextTertiary,
  },
  headerTitle: {
    overflow: 'hidden',
    minWidth: '0',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  label: {
    userSelect: 'none',
    minWidth: '0',
    fontSize: '13px',
    fontWeight: 500,
    lineHeight: '20px',
    color: cssVar.colorTextSecondary,
  },
  labelMain: { flexWrap: 'wrap', minWidth: '0' },
  labelMuted: { color: cssVar.colorTextTertiary },
  modelConfigSection: { paddingBlock: '12px' },
  panel: {
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    width: 'min(384px, 100%)',
    maxHeight: '50vh',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '16px',
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
    boxShadow: cssVar.boxShadowSecondary,
  },
  sidebarPanel: {
    width: '100%',
    height: '100%',
    maxHeight: 'none',
    borderStyle: 'none',
    borderRadius: 0,
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    boxShadow: 'none',
  },
  rowControl: { width: '100%' },
  rowRoot: { paddingBlock: '12px' },
  // Rows inside the advanced list are divided from the previous row; the first has no rule.
  rowSeparated: {
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: { 'default': 'solid', ':first-child': 'none' },
    borderBlockStartColor: cssVar.colorSplit,
  },
  tag: {
    userSelect: 'none',
    alignSelf: 'flex-start',
    width: 'fit-content',
    paddingBlock: '2px',
    paddingInline: '7px',
    borderRadius: '999px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '10px',
    fontWeight: 500,
    lineHeight: 1.2,
    color: cssVar.colorTextQuaternary,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  tooltipContent: { display: 'flex', flexDirection: 'column', gap: '6px', maxWidth: '240px' },
  slider: { width: '100%' },
});

const PARAM_NAME_MAP: Record<ParamKey, string> = {
  frequency_penalty: 'params.frequency_penalty',
  presence_penalty: 'params.presence_penalty',
  temperature: 'params.temperature',
  top_p: 'params.top_p',
};

const PARAM_DEFAULTS: Record<ParamKey, number> = {
  frequency_penalty: 0,
  presence_penalty: 0,
  temperature: 0.7,
  top_p: 1,
};

const PARAM_CONFIG = {
  frequency_penalty: {
    descKey: 'settingModel.frequencyPenalty.desc',
    labelKey: 'settingModel.params.panel.vocabularyRichness',
    slider: { max: 2, min: -2, step: 0.1 },
    tag: 'frequency_penalty',
  },
  presence_penalty: {
    descKey: 'settingModel.presencePenalty.desc',
    labelKey: 'settingModel.params.panel.topicDivergence',
    slider: { max: 2, min: -2, step: 0.1 },
    tag: 'presence_penalty',
  },
  temperature: {
    descKey: 'settingModel.temperature.desc',
    labelKey: 'settingModel.params.panel.creativity',
    slider: { max: 2, min: 0, step: 0.1 },
    tag: 'temperature',
  },
  top_p: {
    descKey: 'settingModel.topP.desc',
    labelKey: 'settingModel.params.panel.openness',
    slider: { max: 1, min: 0, step: 0.1 },
    tag: 'top_p',
  },
} satisfies Record<
  ParamKey,
  {
    descKey: ParamDescKey;
    labelKey: ParamLabelKey;
    slider: SliderConfig;
    tag: string;
  }
>;

const PARAM_ORDER: ParamKey[] = ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty'];

const REASONING_PARAMS_SET = new Set<string>(MODEL_REASONING_EXTEND_PARAMS);

const ADVANCED_OPEN_STORAGE_KEY = 'lobehub-chat-input-params-advanced-open';
const MODEL_CONFIG_OPEN_STORAGE_KEY = 'lobehub-chat-input-params-model-config-open';

const getStoredOpen = (storageKey: string) => {
  if (typeof window === 'undefined') return false;

  return window.localStorage.getItem(storageKey) === 'true';
};

const setStoredOpen = (storageKey: string, open: boolean) => {
  if (typeof window === 'undefined') return;

  window.localStorage.setItem(storageKey, String(open));
};

interface ControlLabelProps {
  muted?: boolean;
  tag?: string;
  title: string;
  tooltip?: string;
}

const ControlLabel = memo<ControlLabelProps>(({ muted, title, tooltip, tag }) => (
  <Flexbox
    align={'flex-start'}
    className={stylex.props(styles.label, muted && styles.labelMuted).className}
    gap={6}
  >
    <Flexbox
      horizontal
      align={'center'}
      className={stylex.props(styles.labelMain).className}
      gap={6}
    >
      {title}
      {tooltip && (
        <InfoTooltip
          title={
            <div {...stylex.props(styles.tooltipContent)}>
              {tag && <span {...stylex.props(styles.tag)}>{tag}</span>}
              <span>{tooltip}</span>
            </div>
          }
        />
      )}
    </Flexbox>
  </Flexbox>
));

interface ControlRowProps {
  action?: ReactNode;
  children?: ReactNode;
  muted?: boolean;
  /** Draw a rule above the row (none above the first sibling). */
  separated?: boolean;
  tag?: string;
  title: string;
  tooltip?: string;
}

const ControlRow = ({
  action,
  children,
  muted,
  separated,
  tag,
  title,
  tooltip,
}: ControlRowProps) => (
  <Flexbox
    className={stylex.props(styles.rowRoot, separated && styles.rowSeparated).className}
    gap={10}
  >
    <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
      <ControlLabel muted={muted} tag={tag} title={title} tooltip={tooltip} />
      {action}
    </Flexbox>
    {children && <div {...stylex.props(styles.rowControl)}>{children}</div>}
  </Flexbox>
);

interface SectionHeaderProps {
  onToggle: () => void;
  open: boolean;
  title: string;
}

const SectionHeader = memo<SectionHeaderProps>(({ onToggle, open, title }) => (
  <button
    aria-expanded={open}
    type="button"
    {...stylex.props(styles.sectionHeader, stylex.defaultMarker())}
    onClick={onToggle}
  >
    <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
      <span {...stylex.props(styles.label, styles.sectionHeaderLabel)}>{title}</span>
      <Icon icon={open ? ChevronUp : ChevronDown} size={18} />
    </Flexbox>
  </button>
));

interface SliderFieldProps extends SliderConfig {
  disabled?: boolean;
  inputWidth?: number;
  onChange: (value: number) => void;
  value?: number;
}

const SliderField = ({
  value,
  disabled,
  onChange,
  min,
  max,
  step,
  unlimitedInput,
  inputWidth = 56,
}: SliderFieldProps) => (
  <SliderWithInput
    changeOnWheel
    className={stylex.props(styles.slider).className}
    controls={false}
    disabled={disabled}
    gap={10}
    max={max}
    min={min}
    size={'small'}
    step={step}
    style={{ height: 28 }}
    unlimitedInput={unlimitedInput}
    value={value}
    styles={{
      input: {
        maxWidth: inputWidth,
      },
    }}
    onChange={onChange}
  />
);

const Controls = ({ variant = 'popover' }: ControlsProps) => {
  const { t } = useTranslation(['setting', 'components']);
  const agentId = useAgentId();
  const { updateAgentConfig } = useUpdateAgentConfig();
  const { allowed: canCreate } = usePermission('create_content');
  // Saving feedback belongs to this form. Keeping it here prevents a write from
  // re-rendering whichever toolbar or sidebar merely hosts the panel.
  const [updating, setUpdating] = useState(false);

  const config = useAgentStore(
    (s) => agentByIdSelectors.getAgentConfigById(agentId)(s) || DEFAULT_AGENT_CONFIG,
    isEqual,
  );
  const { disabledParams, model, provider } = useParamsModelConfig(agentId);
  const modelExtendParamsList = useAiInfraStore(
    aiModelSelectors.modelExtendParams(model, provider),
    isEqual,
  );
  // Reasoning fields are user-level model-instance settings now (edited via
  // the ChatInput Effort control); only non-reasoning params warrant this section
  const hasModelConfig = (modelExtendParamsList ?? []).some(
    (param) => !REASONING_PARAMS_SET.has(param),
  );
  // Same reason: hide the legacy Advanced raw `params.reasoning_effort` for
  // those models — the send path strips it in favor of the instance config
  const hasReasoningExtendParams = (modelExtendParamsList ?? []).some((param) =>
    REASONING_PARAMS_SET.has(param),
  );
  const enableAgentMode = useAgentStore(agentByIdSelectors.getAgentEnableModeById(agentId));
  const form = useForm();
  const [advancedOpen, setAdvancedOpen] = useState(() => getStoredOpen(ADVANCED_OPEN_STORAGE_KEY));
  const [modelConfigOpen, setModelConfigOpen] = useState(() =>
    getStoredOpen(MODEL_CONFIG_OPEN_STORAGE_KEY),
  );
  const [, refreshFormValues] = useState(0);

  const enableContextCompression = form.getValue('chatConfig.enableContextCompression');
  const enableMaxTokens = form.getValue('chatConfig.enableMaxTokens');
  const enableHistoryCount = form.getValue('chatConfig.enableHistoryCount');
  const historyCountValue = form.getValue('chatConfig.historyCount');
  const maxTokensValue = form.getValue('params.max_tokens');
  const inputTemplateValue = form.getValue('chatConfig.inputTemplate');
  const enableAutoScrollOnStreaming = form.getValue('chatConfig.enableAutoScrollOnStreaming');
  const enableStreaming = form.getValue('chatConfig.enableStreaming');
  const enableStaleToolResultTrim = form.getValue('chatConfig.enableStaleToolResultTrim');
  const enableFollowUpChips = form.getValue('chatConfig.enableFollowUpChips');
  const globalFollowUp = useUserStore(systemAgentSelectors.followUpAction, isEqual);
  const globalFollowUpReady =
    globalFollowUp.enabled === true && !!globalFollowUp.model && !!globalFollowUp.provider;
  const showFollowUpHint = !globalFollowUpReady && Boolean(enableFollowUpChips);
  const enableReasoningEffort = form.getValue('chatConfig.enableReasoningEffort');
  const reasoningEffortValue = form.getValue('params.reasoning_effort');
  const { frequency_penalty, presence_penalty, temperature, top_p } = config.params ?? {};

  const historyCountFromStore = useAgentStore((s) =>
    chatConfigByIdSelectors.getHistoryCountById(agentId)(s),
  );
  // Use raw chatConfig value, not the selector with business logic that may force false
  const enableHistoryCountFromStore = useAgentStore(
    (s) => chatConfigByIdSelectors.getChatConfigById(agentId)(s).enableHistoryCount,
  );

  const lastValuesRef = useRef<Record<ParamKey, number | undefined>>({
    frequency_penalty,
    presence_penalty,
    temperature,
    top_p,
  });

  useEffect(() => {
    form.setValues(config);

    if (typeof temperature === 'number') lastValuesRef.current.temperature = temperature;
    if (typeof top_p === 'number') lastValuesRef.current.top_p = top_p;
    if (typeof presence_penalty === 'number') {
      lastValuesRef.current.presence_penalty = presence_penalty;
    }
    if (typeof frequency_penalty === 'number') {
      lastValuesRef.current.frequency_penalty = frequency_penalty;
    }
    refreshFormValues((value) => value + 1);
  }, [config, form, frequency_penalty, presence_penalty, temperature, top_p]);

  // Sync history count values to form
  useEffect(() => {
    // Skip syncing when updating to avoid overwriting user's in-progress edits
    if (updating) return;

    form.setValues({
      chatConfig: {
        ...form.getValue('chatConfig'),
        enableHistoryCount: enableHistoryCountFromStore,
        historyCount: historyCountFromStore,
      },
    });
    refreshFormValues((value) => value + 1);
  }, [form, enableHistoryCountFromStore, historyCountFromStore, updating]);

  const temperatureValue = form.getValue(PARAM_NAME_MAP.temperature);
  const topPValue = form.getValue(PARAM_NAME_MAP.top_p);
  const presencePenaltyValue = form.getValue(PARAM_NAME_MAP.presence_penalty);
  const frequencyPenaltyValue = form.getValue(PARAM_NAME_MAP.frequency_penalty);

  const enabledMap: Record<ParamKey, boolean> = {
    frequency_penalty: typeof frequencyPenaltyValue === 'number',
    presence_penalty: typeof presencePenaltyValue === 'number',
    temperature: typeof temperatureValue === 'number',
    top_p: typeof topPValue === 'number',
  };
  const panelTitle = enableAgentMode
    ? t('settingModel.params.panel.agentTitle')
    : t('settingModel.params.panel.title');

  // Explicit sub-agent model override, if any. When unset, sub-agents follow
  // the parent run's effective model — rendered as the select's empty state
  // (placeholder) rather than a concrete model, so the panel never shows a
  // model the run won't actually use.
  const subAgentModelValue = config.agencyConfig?.subagent?.model
    ? resolveSubAgentModel(config.agencyConfig.subagent)
    : undefined;
  const rawSubAgentChatConfig = config.agencyConfig?.subagent?.chatConfig;
  const subAgentHasReasoningParams = useAiInfraStore(
    aiModelSelectors.isModelHasReasoningExtendParams(
      subAgentModelValue?.model || '',
      subAgentModelValue?.provider || '',
    ),
  );
  const subAgentModelReasoningConfig = useAiInfraStore(
    aiModelSelectors.modelReasoningConfig(
      subAgentModelValue?.model || '',
      subAgentModelValue?.provider || '',
    ),
    isEqual,
  );
  // Warm the overridden sub-agent model's saved reasoning defaults —
  // ReasoningConfigLoader only fetches the main effective model
  const useFetchAiModelReasoningConfig = useAiInfraStore((s) => s.useFetchAiModelReasoningConfig);
  useFetchAiModelReasoningConfig(
    subAgentHasReasoningParams ? subAgentModelValue?.model : undefined,
    subAgentHasReasoningParams ? subAgentModelValue?.provider : undefined,
  );
  // Effective sub-agent chatConfig, built the same way the run does
  // (resolveModelExtendParams / serverCallLlmContextHints): merged parent
  // config with the migrated reasoning fields stripped ← model-instance
  // defaults ← explicit sub-agent overrides. Without the same sanitizing, a
  // legacy parent `chatConfig.reasoningEffort` would show a value the run
  // ignores, so the controls below stay WYSIWYG.
  const subAgentChatConfig = useMemo(
    () =>
      resolveEffectiveReasoningChatConfig({
        agentChatConfig: resolveSubAgentChatConfig(config.chatConfig, rawSubAgentChatConfig) ?? {},
        modelReasoningConfig: subAgentModelReasoningConfig,
        subAgentReasoningOverrides: rawSubAgentChatConfig,
      }),
    [config.chatConfig, rawSubAgentChatConfig, subAgentModelReasoningConfig],
  );
  const subAgentHasModelConfig = useAiInfraStore(
    aiModelSelectors.isModelHasExtendParams(
      subAgentModelValue?.model || '',
      subAgentModelValue?.provider || '',
    ),
  );

  const handleToggle = useCallback(
    async (key: ParamKey, enabled: boolean) => {
      if (!canCreate) return;
      const namePath = PARAM_NAME_MAP[key];
      let newValue: number | undefined;

      if (!enabled) {
        const currentValue = form.getValue(namePath);
        if (typeof currentValue === 'number') {
          lastValuesRef.current[key] = currentValue;
        }
        newValue = undefined;
        form.setValue(namePath, undefined);
      } else {
        const fallback = lastValuesRef.current[key];
        const nextValue = typeof fallback === 'number' ? fallback : PARAM_DEFAULTS[key];
        lastValuesRef.current[key] = nextValue;
        newValue = nextValue;
        form.setValue(namePath, nextValue);
      }
      refreshFormValues((value) => value + 1);

      // Save changes immediately - manually construct config object to ensure latest values are used
      setUpdating(true);
      const currentValues = form.getValues() as PartialDeep<LobeAgentConfig>;
      const prevParams = (currentValues.params ?? {}) as Partial<
        Record<ParamKey, null | number | undefined>
      >;
      const currentParams: Partial<Record<ParamKey, null | number | undefined>> = {
        ...prevParams,
      };

      if (newValue === undefined) {
        // Explicitly delete the property instead of setting it to undefined
        // This ensures the Form state stays in sync
        delete currentParams[key];
        // Use null as a disabled marker (the database preserves null, and the frontend uses it to determine checkbox state)
        currentParams[key] = null;
      } else {
        currentParams[key] = newValue;
      }

      const updatedConfig = {
        ...currentValues,
        params: currentParams as LobeAgentConfig['params'],
      } satisfies PartialDeep<LobeAgentConfig>;

      try {
        await updateAgentConfig(updatedConfig);
      } finally {
        setUpdating(false);
      }
    },
    [canCreate, form, refreshFormValues, setUpdating, updateAgentConfig],
  );

  const handleValuesChange = useMemo(
    () =>
      debounce(async (values: PartialDeep<LobeAgentConfig>) => {
        if (!canCreate) return;
        setUpdating(true);
        try {
          await updateAgentConfig(values);
        } finally {
          setUpdating(false);
        }
      }, 500),
    [canCreate, updateAgentConfig, setUpdating],
  );

  const handleFieldChange = useCallback(
    (namePath: string, value: boolean | number | string) => {
      if (!canCreate) return;
      form.setValue(namePath, value);
      const [scope, key] = namePath.split('.');
      if (scope === 'params' && key in PARAM_NAME_MAP && typeof value === 'number') {
        lastValuesRef.current[key as ParamKey] = value;
      }
      refreshFormValues((current) => current + 1);
      handleValuesChange(form.getValues() as PartialDeep<LobeAgentConfig>);
    },
    [canCreate, form, handleValuesChange, refreshFormValues],
  );

  const handleSubAgentModelChange = useCallback(
    async ({ model, provider }: { model: string; provider: string }) => {
      if (!canCreate) return;
      setUpdating(true);
      try {
        await updateAgentConfig({ agencyConfig: { subagent: { model, provider } } });
      } finally {
        setUpdating(false);
      }
    },
    [canCreate, setUpdating, updateAgentConfig],
  );

  // Back to "follow the main agent model". `null` rather than `undefined`: the
  // config deep-merge skips `undefined` keys, which would keep the old override.
  // The thinking overrides are cleared along with the model they were set for.
  const handleSubAgentModelClear = useCallback(async () => {
    if (!canCreate) return;
    setUpdating(true);
    try {
      await updateAgentConfig({
        agencyConfig: { subagent: { chatConfig: null, model: null, provider: null } },
      });
    } finally {
      setUpdating(false);
    }
  }, [canCreate, setUpdating, updateAgentConfig]);

  const handleSubAgentChatConfigChange = useCallback(
    async (patch: Partial<LobeAgentChatConfig>) => {
      if (!canCreate) return;
      await updateAgentConfig({ agencyConfig: { subagent: { chatConfig: patch } } });
    },
    [canCreate, updateAgentConfig],
  );

  const handleAdvancedOpenChange = useCallback(() => {
    setAdvancedOpen((open) => {
      const nextOpen = !open;
      setStoredOpen(ADVANCED_OPEN_STORAGE_KEY, nextOpen);
      return nextOpen;
    });
  }, []);

  const handleModelConfigOpenChange = useCallback(() => {
    setModelConfigOpen((open) => {
      const nextOpen = !open;
      setStoredOpen(MODEL_CONFIG_OPEN_STORAGE_KEY, nextOpen);
      return nextOpen;
    });
  }, []);

  return (
    <div {...stylex.props(styles.form, variant === 'sidebar' && styles.formSidebar)}>
      <div {...stylex.props(styles.panel, variant === 'sidebar' && styles.sidebarPanel)}>
        <div {...stylex.props(styles.header)}>
          <span {...stylex.props(styles.headerTitle)}>{panelTitle}</span>
          {updating && (
            <div {...stylex.props(styles.headerLoading)}>
              <Spin size="small" />
            </div>
          )}
        </div>
        <div {...stylex.props(styles.body)}>
          <div {...stylex.props(styles.commonSection)}>
            <ControlRow
              tag="compression"
              title={t('settingModel.params.panel.contextCompression')}
              tooltip={t('settingModel.enableContextCompression.desc')}
              action={
                <Switch
                  checked={Boolean(enableContextCompression)}
                  disabled={!canCreate}
                  size={'small'}
                  onChange={(checked) => {
                    handleFieldChange('chatConfig.enableContextCompression', checked);
                  }}
                />
              }
            />
            <ControlRow
              tag="history"
              title={t('settingModel.params.panel.historyLimit')}
              tooltip={t('settingChat.historyCount.desc')}
              action={
                <Switch
                  checked={Boolean(enableHistoryCount)}
                  disabled={!canCreate}
                  size={'small'}
                  onChange={(checked) => {
                    handleFieldChange('chatConfig.enableHistoryCount', checked);
                  }}
                />
              }
            >
              {enableHistoryCount && (
                <SliderField
                  unlimitedInput
                  disabled={!canCreate}
                  inputWidth={56}
                  max={20}
                  min={0}
                  step={1}
                  value={typeof historyCountValue === 'number' ? historyCountValue : 0}
                  onChange={(value) => {
                    handleFieldChange('chatConfig.historyCount', value);
                  }}
                />
              )}
            </ControlRow>
            <ControlRow
              tag="staleToolResultTrim"
              title={t('settingChat.enableStaleToolResultTrim.title')}
              tooltip={t('settingChat.enableStaleToolResultTrim.desc')}
              action={
                <Switch
                  checked={enableStaleToolResultTrim !== false}
                  disabled={!canCreate}
                  size={'small'}
                  onChange={(checked) => {
                    handleFieldChange('chatConfig.enableStaleToolResultTrim', checked);
                  }}
                />
              }
            />
            <ControlRow
              tag="autoScroll"
              title={t('settingChat.enableAutoScrollOnStreaming.title')}
              tooltip={t('settingChat.enableAutoScrollOnStreaming.desc')}
              action={
                <Switch
                  checked={Boolean(enableAutoScrollOnStreaming)}
                  size={'small'}
                  onChange={(checked) => {
                    handleFieldChange('chatConfig.enableAutoScrollOnStreaming', checked);
                  }}
                />
              }
            />
            <ControlRow
              tag="streaming"
              title={t('settingChat.enableStreaming.title')}
              tooltip={t('settingChat.enableStreaming.desc')}
              action={
                <Switch
                  checked={enableStreaming !== false}
                  size={'small'}
                  onChange={(checked) => {
                    handleFieldChange('chatConfig.enableStreaming', checked);
                  }}
                />
              }
            />
            <ControlRow
              tag="followUpChips"
              title={t('settingChat.enableFollowUpChips.title')}
              tooltip={t('settingChat.enableFollowUpChips.desc')}
              action={
                <Switch
                  checked={Boolean(enableFollowUpChips)}
                  size={'small'}
                  onChange={(checked) => {
                    handleFieldChange('chatConfig.enableFollowUpChips', checked);
                  }}
                />
              }
            >
              {showFollowUpHint && (
                <div {...stylex.props(styles.hint)}>
                  {t('settingChat.enableFollowUpChips.notConfiguredHint')}
                </div>
              )}
            </ControlRow>
            <ControlRow
              tag="inputTemplate"
              title={t('settingChat.inputTemplate.title')}
              tooltip={t('settingChat.inputTemplate.desc')}
            >
              <TextArea
                placeholder={t('settingChat.inputTemplate.placeholder')}
                value={typeof inputTemplateValue === 'string' ? inputTemplateValue : ''}
                onChange={(e) => {
                  handleFieldChange('chatConfig.inputTemplate', e.target.value);
                }}
              />
            </ControlRow>
            {enableAgentMode && (
              <ControlRow
                tag="subAgentModel"
                title={t('settingModel.params.panel.subAgentModel')}
                tooltip={t('settingModel.subAgentModel.desc')}
              >
                <ModelSelect
                  allowClear
                  disabled={!canCreate}
                  placeholder={t('settingModel.subAgentModel.followParent')}
                  style={{ width: '100%' }}
                  value={subAgentModelValue}
                  onChange={handleSubAgentModelChange}
                  onClear={handleSubAgentModelClear}
                />
                {/* Thinking / reasoning-effort controls for the overridden
                 * sub-agent model. Hidden while following the parent model —
                 * the sub-agent then inherits the parent's chatConfig wholesale,
                 * so the main panel's controls already describe it. */}
                {subAgentModelValue && subAgentHasModelConfig && (
                  <ControlsForm
                    chatConfig={subAgentChatConfig}
                    disabled={!canCreate}
                    model={subAgentModelValue.model}
                    provider={subAgentModelValue.provider}
                    onChatConfigChange={handleSubAgentChatConfigChange}
                    onUpdatingChange={setUpdating}
                  />
                )}
              </ControlRow>
            )}
          </div>
          {hasModelConfig && (
            <>
              <div {...stylex.props(styles.divider)} />
              <SectionHeader
                open={modelConfigOpen}
                title={t('ModelSwitchPanel.detail.config', { ns: 'components' })}
                onToggle={handleModelConfigOpenChange}
              />
              {modelConfigOpen && (
                <div {...stylex.props(styles.modelConfigSection)}>
                  <ControlsForm
                    hideReasoningParams
                    disabled={!canCreate}
                    model={model}
                    provider={provider}
                    onUpdatingChange={setUpdating}
                  />
                </div>
              )}
            </>
          )}
          {!enableAgentMode && (
            <>
              <div {...stylex.props(styles.divider)} />
              <SectionHeader
                open={advancedOpen}
                title={t('settingModel.params.panel.advanced')}
                onToggle={handleAdvancedOpenChange}
              />
              {advancedOpen && (
                <div {...stylex.props(styles.advancedContent)}>
                  {PARAM_ORDER.filter((key) => !disabledParams?.includes(key)).map((key) => {
                    const meta = PARAM_CONFIG[key];
                    const enabled = enabledMap[key];

                    return (
                      <ControlRow
                        separated
                        key={key}
                        muted={!enabled}
                        tag={meta.tag}
                        title={t(meta.labelKey)}
                        tooltip={t(meta.descKey)}
                        action={
                          <Switch
                            checked={enabled}
                            disabled={!canCreate}
                            size={'small'}
                            onChange={(checked) => {
                              handleToggle(key, checked);
                            }}
                          />
                        }
                      >
                        {enabled && (
                          <SliderField
                            disabled={!canCreate}
                            value={form.getValue(PARAM_NAME_MAP[key])}
                            onChange={(value) => {
                              handleFieldChange(PARAM_NAME_MAP[key], value);
                            }}
                            {...meta.slider}
                          />
                        )}
                      </ControlRow>
                    );
                  })}
                  <ControlRow
                    separated
                    tag="max_tokens"
                    title={t('settingModel.params.panel.responseLength')}
                    tooltip={t('settingModel.maxTokens.desc')}
                    action={
                      <Switch
                        checked={Boolean(enableMaxTokens)}
                        disabled={!canCreate}
                        size={'small'}
                        onChange={(checked) => {
                          if (checked && typeof maxTokensValue !== 'number') {
                            form.setValue('params.max_tokens', 4096);
                          }
                          handleFieldChange('chatConfig.enableMaxTokens', checked);
                        }}
                      />
                    }
                  >
                    {enableMaxTokens && (
                      <SliderField
                        unlimitedInput
                        disabled={!canCreate}
                        inputWidth={64}
                        max={32_000}
                        min={0}
                        step={100}
                        value={typeof maxTokensValue === 'number' ? maxTokensValue : 4096}
                        onChange={(value) => {
                          handleFieldChange('params.max_tokens', value);
                        }}
                      />
                    )}
                  </ControlRow>
                  {!hasReasoningExtendParams && (
                    <ControlRow
                      separated
                      tag="reasoning_effort"
                      title={t('settingModel.reasoningEffort.title')}
                      tooltip={t('settingModel.reasoningEffort.desc')}
                      action={
                        <Switch
                          checked={Boolean(enableReasoningEffort)}
                          size={'small'}
                          onChange={(checked) => {
                            if (checked && typeof reasoningEffortValue !== 'string') {
                              form.setValue('params.reasoning_effort', 'medium');
                            }
                            handleFieldChange('chatConfig.enableReasoningEffort', checked);
                          }}
                        />
                      }
                    >
                      {enableReasoningEffort && (
                        <Select
                          size={'small'}
                          style={{ width: '100%' }}
                          options={[
                            { label: t('settingModel.reasoningEffort.options.low'), value: 'low' },
                            {
                              label: t('settingModel.reasoningEffort.options.medium'),
                              value: 'medium',
                            },
                            {
                              label: t('settingModel.reasoningEffort.options.high'),
                              value: 'high',
                            },
                          ]}
                          value={
                            typeof reasoningEffortValue === 'string'
                              ? reasoningEffortValue
                              : 'medium'
                          }
                          onChange={(value) => {
                            handleFieldChange('params.reasoning_effort', value);
                          }}
                        />
                      )}
                    </ControlRow>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default Controls;
