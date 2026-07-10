import type { CreatedLevelSliderProps } from './createLevelSlider';
import { createLevelSliderComponent } from './createLevelSlider';

const GPT56_REASONING_EFFORT_LEVELS = ['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
type GPT56ReasoningEffort = (typeof GPT56_REASONING_EFFORT_LEVELS)[number];

export type GPT56ReasoningEffortSliderProps = CreatedLevelSliderProps<GPT56ReasoningEffort>;

export const GPT56ReasoningEffortSlider = createLevelSliderComponent<GPT56ReasoningEffort>({
  configKey: 'gpt5_6ReasoningEffort',
  defaultValue: 'medium',
  levels: GPT56_REASONING_EFFORT_LEVELS,
  style: { minWidth: 270 },
});
