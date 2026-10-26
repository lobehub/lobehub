'use client';

import type { AiModelReasoningEffortSettings, ReasoningEffortLevel } from 'model-bank';
import { resolveReasoningEffortLevel } from 'model-bank/aiModel';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import LevelSlider from './LevelSlider';

export interface ReasoningEffortSliderProps {
  disabled?: boolean;
  onChange?: (value: ReasoningEffortLevel) => void;
  /** The model card's effort control; the slider renders its levels and default. */
  settings: AiModelReasoningEffortSettings;
  value?: ReasoningEffortLevel;
}

/**
 * One slider for every model's reasoning effort: the levels and the default
 * come from the model card, so a new model never needs its own component.
 */
const ReasoningEffortSlider = memo<ReasoningEffortSliderProps>(
  ({ disabled, onChange, settings, value }) => {
    const { t } = useTranslation('chat');
    const marks = useMemo(
      () =>
        Object.fromEntries(
          settings.levels.map((level, index) => [index, t(`reasoningEffort.levels.${level}`)]),
        ),
      [settings.levels, t],
    );

    return (
      <LevelSlider<ReasoningEffortLevel>
        defaultValue={settings.default}
        disabled={disabled}
        levels={settings.levels}
        marks={marks}
        style={{ minWidth: 200 }}
        value={resolveReasoningEffortLevel(settings, value)}
        onChange={onChange}
      />
    );
  },
);

export default ReasoningEffortSlider;
