import { type CreatedLevelSliderProps } from './createLevelSlider';
import { createLevelSliderComponent } from './createLevelSlider';

const DEEPSEEK_V4_REASONING_EFFORT_LEVELS = ['high', 'max'] as const;
type DeepseekV4ReasoningEffort = (typeof DEEPSEEK_V4_REASONING_EFFORT_LEVELS)[number];

export type DeepseekV4ReasoningEffortSliderProps =
  CreatedLevelSliderProps<DeepseekV4ReasoningEffort>;

const DeepseekV4ReasoningEffortSlider = createLevelSliderComponent<DeepseekV4ReasoningEffort>({
  configKey: 'deepseekV4ReasoningEffort',
  defaultValue: 'high',
  levels: DEEPSEEK_V4_REASONING_EFFORT_LEVELS,
  style: { minWidth: 200 },
});

export default DeepseekV4ReasoningEffortSlider;
