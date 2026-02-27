import { type CreatedLevelSliderProps } from './createLevelSlider';
import { createLevelSliderComponent } from './createLevelSlider';

const GPT52_REASONING_EFFORT_LEVELS = ['none', 'low', 'medium', 'high', 'xhigh'] as const;
type GPT52ReasoningEffort = (typeof GPT52_REASONING_EFFORT_LEVELS)[number];

export type GPT52ReasoningEffortSliderProps = CreatedLevelSliderProps<GPT52ReasoningEffort>;

const GPT52ReasoningEffortSlider = createLevelSliderComponent<GPT52ReasoningEffort>({
  configKey: 'gpt5_2ReasoningEffort',
  defaultValue: 'none',
  levels: GPT52_REASONING_EFFORT_LEVELS,
  style: { minWidth: 230 },
});

export default GPT52ReasoningEffortSlider;
