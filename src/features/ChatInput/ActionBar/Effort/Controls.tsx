import { Flexbox, Icon } from '@lobehub/ui';
import { Divider } from 'antd';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { CheckIcon } from 'lucide-react';
import type { AiModelReasoningConfig } from 'model-bank';
import { MODEL_REASONING_PARAM_DEFAULTS, MODEL_REASONING_PARAM_LEVELS } from 'model-bank';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

const styles = createStaticStyles(({ css }) => ({
  active: css`
    background: ${cssVar.colorFillTertiary};
  `,
  check: css`
    font-size: 16px;
    color: ${cssVar.colorPrimary};
  `,
  label: css`
    font-size: 14px;
    color: ${cssVar.colorText};
  `,
  option: css`
    cursor: pointer;

    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;

    width: 100%;
    padding-block: 8px;
    padding-inline: 8px;
    border: none;
    border-radius: ${cssVar.borderRadius};

    text-align: start;

    background: transparent;

    transition: background-color 0.2s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
}));

interface OptionProps {
  active: boolean;
  label: string;
  onClick: () => void;
}

// A real <button> so keyboard-only and screen-reader users can focus each
// level and toggle it with Enter/Space
const Option = memo<OptionProps>(({ active, label, onClick }) => (
  <button
    aria-pressed={active}
    className={cx(styles.option, active && styles.active)}
    type={'button'}
    onClick={onClick}
  >
    <span className={styles.label}>{label}</span>
    {active && <Icon className={styles.check} icon={CheckIcon} />}
  </button>
));

interface ControlsProps {
  model: string;
  provider: string;
}

const Controls = memo<ControlsProps>(({ model, provider }) => {
  const { t } = useTranslation('chat');

  const reasoningParams = useAiInfraStore(
    aiModelSelectors.modelReasoningExtendParams(model, provider),
    isEqual,
  );
  const config = useAiInfraStore(aiModelSelectors.modelReasoningConfig(model, provider), isEqual);
  const updating = useAiInfraStore(
    aiModelSelectors.isModelReasoningConfigUpdating(model, provider),
  );
  const updateModelReasoningConfig = useAiInfraStore((s) => s.updateModelReasoningConfig);

  // modelReasoningExtendParams only returns MODEL_REASONING_EXTEND_PARAMS
  // entries, so the narrowing cast is safe
  const effortKey = reasoningParams.find((param) => param !== 'reasoningMode') as
    Exclude<keyof AiModelReasoningConfig, 'reasoningMode'> | undefined;
  const hasReasoningMode = reasoningParams.includes('reasoningMode');

  // Keep the same model-dependent fallback as the ControlsForm slider
  const effortDefault = effortKey
    ? effortKey === 'gpt5_2ReasoningEffort' && model === 'gpt-5.5'
      ? 'medium'
      : MODEL_REASONING_PARAM_DEFAULTS[effortKey]
    : undefined;
  const effortValue = (effortKey && config?.[effortKey]) ?? effortDefault;
  const modeValue = config?.reasoningMode ?? MODEL_REASONING_PARAM_DEFAULTS.reasoningMode;

  const handleSelect = async (patch: AiModelReasoningConfig) => {
    if (updating) return;
    // failure already rolls back and toasts inside the store action
    await updateModelReasoningConfig(model, provider, patch).catch(() => {});
  };

  return (
    <Flexbox gap={4} style={{ opacity: updating ? 0.6 : undefined }}>
      {effortKey &&
        MODEL_REASONING_PARAM_LEVELS[effortKey].map((level) => (
          <Option
            active={effortValue === level}
            key={level}
            label={t(`reasoningEffort.levels.${level}`)}
            onClick={() => handleSelect({ [effortKey]: level })}
          />
        ))}
      {hasReasoningMode && (
        <>
          {effortKey && <Divider style={{ margin: 0 }} />}
          {MODEL_REASONING_PARAM_LEVELS.reasoningMode.map((mode) => (
            <Option
              active={modeValue === mode}
              key={mode}
              label={t(`reasoningEffort.mode.${mode}`)}
              onClick={() => handleSelect({ reasoningMode: mode })}
            />
          ))}
        </>
      )}
    </Flexbox>
  );
});

export default Controls;
