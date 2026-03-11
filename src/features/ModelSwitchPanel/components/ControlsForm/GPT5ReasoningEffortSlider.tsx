import { type CreatedLevelSliderProps } from './createLevelSlider';
import { createLevelSliderComponent } from './createLevelSlider';

const GPT5_REASONING_EFFORT_LEVELS = ['minimal', 'low', 'medium', 'high'] as const;
type GPT5ReasoningEffort = (typeof GPT5_REASONING_EFFORT_LEVELS)[number];

export type GPT5ReasoningEffortSliderProps = CreatedLevelSliderProps<GPT5ReasoningEffort>;

const GPT5ReasoningEffortSlider = createLevelSliderComponent<GPT5ReasoningEffort>({
  configKey: 'gpt5ReasoningEffort',
  defaultValue: 'medium',
  levels: GPT5_REASONING_EFFORT_LEVELS,
  style: { minWidth: 200 },
});

export default GPT5ReasoningEffortSlider;
