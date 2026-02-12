import { type CreatedLevelSliderProps } from './createLevelSlider';
import { createLevelSliderComponent } from './createLevelSlider';

const GPT51_REASONING_EFFORT_LEVELS = ['none', 'low', 'medium', 'high'] as const;
type GPT51ReasoningEffort = (typeof GPT51_REASONING_EFFORT_LEVELS)[number];

export type GPT51ReasoningEffortSliderProps = CreatedLevelSliderProps<GPT51ReasoningEffort>;

const GPT51ReasoningEffortSlider = createLevelSliderComponent<GPT51ReasoningEffort>({
  configKey: 'gpt5_1ReasoningEffort',
  defaultValue: 'none',
  levels: GPT51_REASONING_EFFORT_LEVELS,
  style: { minWidth: 200 },
});

export default GPT51ReasoningEffortSlider;
