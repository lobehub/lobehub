import type { CreatedLevelSliderProps } from './createLevelSlider';
import { createLevelSliderComponent } from './createLevelSlider';

const DEEPSEEK_REASONING_EFFORT_LEVELS = ['none', 'high', 'max'] as const;

type DeepSeekReasoningEffort = (typeof DEEPSEEK_REASONING_EFFORT_LEVELS)[number];

export type DeepSeekReasoningEffortSliderProps = CreatedLevelSliderProps<DeepSeekReasoningEffort>;

const DeepSeekReasoningEffortSlider = createLevelSliderComponent<DeepSeekReasoningEffort>({
  configKey: 'deepseekV4ReasoningEffort',
  defaultValue: 'high',
  levels: DEEPSEEK_REASONING_EFFORT_LEVELS,
  style: { minWidth: 180 },
});

export default DeepSeekReasoningEffortSlider;
