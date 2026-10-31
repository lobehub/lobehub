import { Checkbox, CheckboxGroup, Flexbox, Select, Text } from '@lobehub/ui';
import {
  type AiModelReasoningEffortSettings,
  REASONING_EFFORT_LEVELS,
  type ReasoningEffortLevel,
} from 'model-bank/aiModel';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { setReasoningEffortControlsThinking, updateReasoningEffortLevels } from './utils';

interface ReasoningEffortSettingsFieldProps {
  disabled?: boolean;
  onChange?: (value: AiModelReasoningEffortSettings | undefined) => void;
  value?: AiModelReasoningEffortSettings;
}

/**
 * Declares a custom model's reasoning effort control: the levels its API
 * accepts and the one sent when the user has not picked any. Clearing every
 * level removes the control.
 */
const ReasoningEffortSettingsField = memo<ReasoningEffortSettingsFieldProps>(
  ({ disabled, onChange, value }) => {
    const { t } = useTranslation(['modelProvider', 'chat']);

    const labelOf = useCallback(
      (level: ReasoningEffortLevel) => {
        const label = t(`reasoningEffort.levels.${level}`, { ns: 'chat' });
        // `none` and `no_think` share the label "Off"; the raw value tells them apart.
        return `${label} (${level})`;
      },
      [t],
    );

    const levelOptions = useMemo(
      () => REASONING_EFFORT_LEVELS.map((level) => ({ label: labelOf(level), value: level })),
      [labelOf],
    );

    const handleLevelsChange = (levels: string[]) =>
      onChange?.(updateReasoningEffortLevels(value, levels as ReasoningEffortLevel[]));

    return (
      <Flexbox gap={12}>
        <CheckboxGroup
          horizontal
          disabled={disabled}
          gap={12}
          options={levelOptions}
          style={{ flexWrap: 'wrap' }}
          value={value?.levels ?? []}
          onChange={handleLevelsChange}
        />
        {value && (
          <Flexbox horizontal align={'center'} gap={8}>
            <Text type={'secondary'}>
              {t('providerModels.item.modelConfig.reasoningEffort.default')}
            </Text>
            <Select
              disabled={disabled}
              options={value.levels.map((level) => ({ label: labelOf(level), value: level }))}
              style={{ minWidth: 160 }}
              value={value.default}
              onChange={(level) => onChange?.({ ...value, default: level })}
            />
          </Flexbox>
        )}
        {value && (
          <Checkbox
            checked={!!value.controlsThinking}
            disabled={disabled}
            onChange={(checked) => onChange?.(setReasoningEffortControlsThinking(value, checked))}
          >
            {t('providerModels.item.modelConfig.reasoningEffort.controlsThinking')}
          </Checkbox>
        )}
      </Flexbox>
    );
  },
);

export default ReasoningEffortSettingsField;
