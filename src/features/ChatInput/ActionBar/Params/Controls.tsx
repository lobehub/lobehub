import { DEFAULT_AGENT_CONFIG } from '@lobechat/const';
import { Flexbox, Icon, SliderWithInput } from '@lobehub/ui';
import { Form as AntdForm, Switch } from 'antd';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { debounce } from 'es-toolkit/compat';
import isEqual from 'fast-deep-equal';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PartialDeep } from 'type-fest';

import InfoTooltip from '@/components/InfoTooltip';
import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import ControlsForm from '@/features/ModelSwitchPanel/components/ControlsForm';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';
import type { LobeAgentConfig } from '@/types/agent';

import { useAgentId } from '../../hooks/useAgentId';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';

interface ControlsProps {
  setUpdating: (updating: boolean) => void;
  updating: boolean;
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

const styles = createStaticStyles(({ css }) => ({
  advancedContent: css`
    display: flex;
    flex-direction: column;

    .control-row {
      border-block-start: 1px solid ${cssVar.colorSplit};
    }

    .control-row:first-child {
      border-block-start: none;
    }
  `,
  sectionHeader: css`
    cursor: pointer;

    width: calc(100% + 16px);
    margin-inline: -8px;
    padding-block: 12px;
    padding-inline: 8px;
    border: none;
    border-radius: 10px;

    font: inherit;
    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
    text-align: start;

    background: transparent;

    transition: color 0.2s ease;

    &:hover {
      color: ${cssVar.colorText};
    }

    &:hover .section-header-label {
      color: ${cssVar.colorText};
    }

    &:focus-visible {
      outline: 1px solid ${cssVar.colorBorder};
      outline-offset: 2px;
    }
  `,
  body: css`
    overflow-y: auto;
    overscroll-behavior: contain;
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;

    min-height: 0;
    padding-block-end: 4px;
    padding-inline: 12px;
  `,
  commonSection: css`
    display: flex;
    flex-direction: column;
    padding-block: 0;
  `,
  divider: css`
    height: 1px;
    background: ${cssVar.colorSplit};
  `,
  form: css`
    margin: 0;
  `,
  header: css`
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;

    padding-block: 16px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorSplit};

    font-size: 14px;
    font-weight: 600;
    line-height: 1.4;
    color: ${cssVar.colorText};
  `,
  headerLoading: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 18px;
    height: 18px;

    color: ${cssVar.colorTextTertiary};
  `,
  headerTitle: css`
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  label: css`
    user-select: none;

    min-width: 0;

    font-size: 13px;
    font-weight: 500;
    line-height: 20px;
    color: ${cssVar.colorTextSecondary};
  `,
  labelMain: css`
    flex-wrap: wrap;
    min-width: 0;
  `,
  muted: css`
    .control-label {
      color: ${cssVar.colorTextTertiary};
    }
  `,
  modelConfigSection: css`
    padding-block: 12px;

    .ant-form {
      margin: 0;
    }

    .ant-form-item {
      padding-block: 12px;
    }

    .ant-form-item-row {
      gap: 10px;
    }

    .ant-form-item-label > label {
      font-size: 13px;
      font-weight: 500;
      line-height: 20px;
      color: ${cssVar.colorTextSecondary};
    }

    .ant-form-item-label > label div {
      color: ${cssVar.colorTextSecondary};
    }

    .ant-form-item-label > label small,
    .ant-form-item-label > label small *:not(a) {
      font-size: 12px;
      font-weight: 400;
      line-height: 18px;
      color: ${cssVar.colorTextTertiary};
    }

    .ant-form-item:first-child {
      padding-block-start: 0;
    }

    .ant-form-item:last-child {
      padding-block-end: 0;
    }

    .ant-divider {
      display: none;
    }
  `,
  panel: css`
    overflow: hidden;
    display: flex;
    flex-direction: column;

    width: min(384px, 100%);
    max-height: 50vh;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 16px;

    background: ${cssVar.colorBgElevated};
    box-shadow: ${cssVar.boxShadowSecondary};

    .ant-switch {
      min-width: 28px;
      background: ${cssVar.colorFillSecondary};
    }

    .ant-switch .ant-switch-handle::before {
      background: ${cssVar.colorBgElevated};
    }

    .ant-switch.ant-switch-checked {
      background: ${cssVar.colorText};
    }

    .ant-form-item {
      margin: 0;
    }
  `,
  sidebarPanel: css`
    width: 100%;
    height: 100%;
    max-height: none;
    border: none;
    border-radius: 0;

    background: transparent;
    box-shadow: none;
  `,
  rowControl: css`
    width: 100%;
  `,
  rowRoot: css`
    padding-block: 12px;
  `,
  tag: css`
    user-select: none;

    align-self: flex-start;

    width: fit-content;
    padding-block: 2px;
    padding-inline: 7px;
    border-radius: 999px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 10px;
    font-weight: 500;
    line-height: 1.2;
    color: ${cssVar.colorTextQuaternary};

    background: ${cssVar.colorFillQuaternary};
  `,
  tooltipContent: css`
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-width: 240px;
  `,
  slider: css`
    width: 100%;

    .ant-slider {
      margin-block: 0;
      margin-inline: 0;
    }

    .ant-slider-rail {
      background: ${cssVar.colorFillQuaternary};
    }

    .ant-slider-track {
      background: ${cssVar.colorTextSecondary};
    }

    .ant-slider-handle::after {
      background: ${cssVar.colorBgElevated};
      box-shadow: 0 0 0 2px ${cssVar.colorTextSecondary};
    }

    .ant-slider-handle:hover::after,
    .ant-slider-handle:focus::after,
    .ant-slider-handle:active::after {
      box-shadow: 0 0 0 3px ${cssVar.colorTextSecondary};
    }

    .ant-input-number,
    .ant-input-number-affix-wrapper {
      overflow: hidden;

      height: 28px;
      border: none;
      border-radius: 10px;

      color: ${cssVar.colorTextSecondary};

      background: ${cssVar.colorFillTertiary};
      box-shadow: none;
    }

    .ant-input-number:hover,
    .ant-input-number-focused,
    .ant-input-number-affix-wrapper:hover,
    .ant-input-number-affix-wrapper-focused {
      background: ${cssVar.colorFillSecondary};
      box-shadow: none;
    }

    .ant-input-number-input {
      height: 28px;
      padding-inline: 6px;

      font-size: 13px;
      color: ${cssVar.colorTextSecondary};
      text-align: center;
    }
  `,
}));

const PARAM_NAME_MAP: Record<ParamKey, (string | number)[]> = {
  frequency_penalty: ['params', 'frequency_penalty'],
  presence_penalty: ['params', 'presence_penalty'],
  temperature: ['params', 'temperature'],
  top_p: ['params', 'top_p'],
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
  tag?: string;
  title: string;
  tooltip?: string;
}

const ControlLabel = memo<ControlLabelProps>(({ title, tooltip, tag }) => (
  <Flexbox align={'flex-start'} className={cx(styles.label, 'control-label')} gap={6}>
    <Flexbox horizontal align={'center'} className={styles.labelMain} gap={6}>
      {title}
      {tooltip && (
        <InfoTooltip
          title={
            <div className={styles.tooltipContent}>
              {tag && <span className={styles.tag}>{tag}</span>}
              <span>{tooltip}</span>
            </div>
          }
        />
      )}
    </Flexbox>
  </Flexbox>
));

interface ControlRowProps {
  action: ReactNode;
  children?: ReactNode;
  muted?: boolean;
  tag?: string;
  title: string;
  tooltip?: string;
}

const ControlRow = memo<ControlRowProps>(({ action, children, muted, tag, title, tooltip }) => (
  <Flexbox className={cx('control-row', styles.rowRoot, muted && styles.muted)} gap={10}>
    <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
      <ControlLabel tag={tag} title={title} tooltip={tooltip} />
      {action}
    </Flexbox>
    {children && <div className={styles.rowControl}>{children}</div>}
  </Flexbox>
));

interface SectionHeaderProps {
  onToggle: () => void;
  open: boolean;
  title: string;
}

const SectionHeader = memo<SectionHeaderProps>(({ onToggle, open, title }) => (
  <button aria-expanded={open} className={styles.sectionHeader} type="button" onClick={onToggle}>
    <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
      <span className={cx(styles.label, 'section-header-label')}>{title}</span>
      <Icon icon={open ? ChevronUp : ChevronDown} size={18} />
    </Flexbox>
  </button>
));

interface SliderFieldProps extends SliderConfig {
  inputWidth?: number;
  onChange: (value: number) => void;
  value?: number;
}

const SliderField = memo<SliderFieldProps>(
  ({ value, onChange, min, max, step, unlimitedInput, inputWidth = 56 }) => (
    <SliderWithInput
      changeOnWheel
      className={styles.slider}
      controls={false}
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
  ),
);

const Controls = memo<ControlsProps>(({ setUpdating, updating, variant = 'popover' }) => {
  const { t } = useTranslation(['setting', 'components']);
  const agentId = useAgentId();
  const { updateAgentConfig } = useUpdateAgentConfig();

  const config = useAgentStore(
    (s) => agentByIdSelectors.getAgentConfigById(agentId)(s) || DEFAULT_AGENT_CONFIG,
    isEqual,
  );
  const agentModel = useAgentStore((s) => agentByIdSelectors.getAgentModelById(agentId)(s));
  const agentProvider = useAgentStore((s) =>
    agentByIdSelectors.getAgentModelProviderById(agentId)(s),
  );
  const enableAgentMode = useAgentStore(agentByIdSelectors.getAgentEnableModeById(agentId));
  const hasModelConfig = useAiInfraStore(
    aiModelSelectors.isModelHasExtendParams(agentModel ?? '', agentProvider ?? ''),
  );
  const [form] = AntdForm.useForm();
  const [advancedOpen, setAdvancedOpen] = useState(() => getStoredOpen(ADVANCED_OPEN_STORAGE_KEY));
  const [modelConfigOpen, setModelConfigOpen] = useState(() =>
    getStoredOpen(MODEL_CONFIG_OPEN_STORAGE_KEY),
  );
  const [, refreshFormValues] = useState(0);

  const enableContextCompression = form.getFieldValue(['chatConfig', 'enableContextCompression']);
  const enableMaxTokens = form.getFieldValue(['chatConfig', 'enableMaxTokens']);
  const enableHistoryCount = form.getFieldValue(['chatConfig', 'enableHistoryCount']);
  const historyCountValue = form.getFieldValue(['chatConfig', 'historyCount']);
  const maxTokensValue = form.getFieldValue(['params', 'max_tokens']);
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
    form.setFieldsValue(config);

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

    form.setFieldsValue({
      chatConfig: {
        ...form.getFieldValue('chatConfig'),
        enableHistoryCount: enableHistoryCountFromStore,
        historyCount: historyCountFromStore,
      },
    });
    refreshFormValues((value) => value + 1);
  }, [form, enableHistoryCountFromStore, historyCountFromStore, updating]);

  const temperatureValue = form.getFieldValue(PARAM_NAME_MAP.temperature);
  const topPValue = form.getFieldValue(PARAM_NAME_MAP.top_p);
  const presencePenaltyValue = form.getFieldValue(PARAM_NAME_MAP.presence_penalty);
  const frequencyPenaltyValue = form.getFieldValue(PARAM_NAME_MAP.frequency_penalty);

  const enabledMap: Record<ParamKey, boolean> = {
    frequency_penalty: typeof frequencyPenaltyValue === 'number',
    presence_penalty: typeof presencePenaltyValue === 'number',
    temperature: typeof temperatureValue === 'number',
    top_p: typeof topPValue === 'number',
  };
  const panelTitle = enableAgentMode
    ? t('settingModel.params.panel.agentTitle')
    : t('settingModel.params.panel.title');

  const handleToggle = useCallback(
    async (key: ParamKey, enabled: boolean) => {
      const namePath = PARAM_NAME_MAP[key];
      let newValue: number | undefined;

      if (!enabled) {
        const currentValue = form.getFieldValue(namePath);
        if (typeof currentValue === 'number') {
          lastValuesRef.current[key] = currentValue;
        }
        newValue = undefined;
        form.setFieldValue(namePath, undefined);
      } else {
        const fallback = lastValuesRef.current[key];
        const nextValue = typeof fallback === 'number' ? fallback : PARAM_DEFAULTS[key];
        lastValuesRef.current[key] = nextValue;
        newValue = nextValue;
        form.setFieldValue(namePath, nextValue);
      }
      refreshFormValues((value) => value + 1);

      // Save changes immediately - manually construct config object to ensure latest values are used
      setUpdating(true);
      const currentValues = form.getFieldsValue(true) as PartialDeep<LobeAgentConfig>;
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
    [form, refreshFormValues, setUpdating, updateAgentConfig],
  );

  const handleValuesChange = useMemo(
    () =>
      debounce(async (values: PartialDeep<LobeAgentConfig>) => {
        setUpdating(true);
        try {
          await updateAgentConfig(values);
        } finally {
          setUpdating(false);
        }
      }, 500),
    [updateAgentConfig, setUpdating],
  );

  const handleFieldChange = useCallback(
    (namePath: (string | number)[], value: boolean | number) => {
      form.setFieldValue(namePath, value);
      if (
        namePath[0] === 'params' &&
        typeof namePath[1] === 'string' &&
        namePath[1] in PARAM_NAME_MAP &&
        typeof value === 'number'
      ) {
        lastValuesRef.current[namePath[1] as ParamKey] = value;
      }
      refreshFormValues((current) => current + 1);
      handleValuesChange(form.getFieldsValue(true) as PartialDeep<LobeAgentConfig>);
    },
    [form, handleValuesChange, refreshFormValues],
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
    <div className={styles.form}>
      <div className={cx(styles.panel, variant === 'sidebar' && styles.sidebarPanel)}>
        <div className={styles.header}>
          <span className={styles.headerTitle}>{panelTitle}</span>
          {updating && (
            <div className={styles.headerLoading}>
              <NeuralNetworkLoading size={18} />
            </div>
          )}
        </div>
        <div className={styles.body}>
          <div className={styles.commonSection}>
            <ControlRow
              tag="compression"
              title={t('settingModel.params.panel.contextCompression')}
              tooltip={t('settingModel.enableContextCompression.desc')}
              action={
                <Switch
                  checked={Boolean(enableContextCompression)}
                  size={'small'}
                  onChange={(checked) => {
                    handleFieldChange(['chatConfig', 'enableContextCompression'], checked);
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
                  size={'small'}
                  onChange={(checked) => {
                    handleFieldChange(['chatConfig', 'enableHistoryCount'], checked);
                  }}
                />
              }
            >
              {enableHistoryCount && (
                <SliderField
                  unlimitedInput
                  inputWidth={56}
                  max={20}
                  min={0}
                  step={1}
                  value={typeof historyCountValue === 'number' ? historyCountValue : 0}
                  onChange={(value) => {
                    handleFieldChange(['chatConfig', 'historyCount'], value);
                  }}
                />
              )}
            </ControlRow>
          </div>
          {hasModelConfig && (
            <>
              <div className={styles.divider} />
              <SectionHeader
                open={modelConfigOpen}
                title={t('ModelSwitchPanel.detail.config', { ns: 'components' })}
                onToggle={handleModelConfigOpenChange}
              />
              {modelConfigOpen && (
                <div className={styles.modelConfigSection}>
                  <ControlsForm
                    model={agentModel}
                    provider={agentProvider}
                    onUpdatingChange={setUpdating}
                  />
                </div>
              )}
            </>
          )}
          {!enableAgentMode && (
            <>
              <div className={styles.divider} />
              <SectionHeader
                open={advancedOpen}
                title={t('settingModel.params.panel.advanced')}
                onToggle={handleAdvancedOpenChange}
              />
              {advancedOpen && (
                <div className={styles.advancedContent}>
                  {PARAM_ORDER.map((key) => {
                    const meta = PARAM_CONFIG[key];
                    const enabled = enabledMap[key];

                    return (
                      <ControlRow
                        key={key}
                        muted={!enabled}
                        tag={meta.tag}
                        title={t(meta.labelKey)}
                        tooltip={t(meta.descKey)}
                        action={
                          <Switch
                            checked={enabled}
                            size={'small'}
                            onChange={(checked) => {
                              handleToggle(key, checked);
                            }}
                          />
                        }
                      >
                        {enabled && (
                          <SliderField
                            value={form.getFieldValue(PARAM_NAME_MAP[key])}
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
                    tag="max_tokens"
                    title={t('settingModel.params.panel.responseLength')}
                    tooltip={t('settingModel.maxTokens.desc')}
                    action={
                      <Switch
                        checked={Boolean(enableMaxTokens)}
                        size={'small'}
                        onChange={(checked) => {
                          handleFieldChange(['chatConfig', 'enableMaxTokens'], checked);
                        }}
                      />
                    }
                  >
                    {enableMaxTokens && (
                      <SliderField
                        unlimitedInput
                        inputWidth={64}
                        max={32_000}
                        min={0}
                        step={100}
                        value={typeof maxTokensValue === 'number' ? maxTokensValue : 0}
                        onChange={(value) => {
                          handleFieldChange(['params', 'max_tokens'], value);
                        }}
                      />
                    )}
                  </ControlRow>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
});

export default Controls;
