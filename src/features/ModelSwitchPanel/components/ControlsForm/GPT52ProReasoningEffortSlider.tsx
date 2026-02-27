import { type CreatedLevelSliderProps } from './createLevelSlider';
import { createLevelSliderComponent } from './createLevelSlider';

const GPT52_PRO_REASONING_EFFORT_LEVELS = ['medium', 'high', 'xhigh'] as const;
type GPT52ProReasoningEffort = (typeof GPT52_PRO_REASONING_EFFORT_LEVELS)[number];

export type GPT52ProReasoningEffortSliderProps = CreatedLevelSliderProps<GPT52ProReasoningEffort>;

const GPT52ProReasoningEffortSlider = createLevelSliderComponent<GPT52ProReasoningEffort>({
  configKey: 'gpt5_2ProReasoningEffort',
  defaultValue: 'medium',
  levels: GPT52_PRO_REASONING_EFFORT_LEVELS,
  style: { minWidth: 160 },
});

export default GPT52ProReasoningEffortSlider;
