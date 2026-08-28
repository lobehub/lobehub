import type { CreatedLevelSliderProps } from './createLevelSlider';
import { createLevelSliderComponent } from './createLevelSlider';

const DEEPSEEK_REASONING_EFFORT_LEVELS = ['none', 'high', 'max'] as const;
const DEEPSEEK_V4_GA_REASONING_EFFORT_LEVELS = ['none', 'low', 'high', 'max'] as const;

type DeepSeekReasoningEffort = (typeof DEEPSEEK_REASONING_EFFORT_LEVELS)[number];
type DeepSeekV4GAReasoningEffort = (typeof DEEPSEEK_V4_GA_REASONING_EFFORT_LEVELS)[number];

export type DeepSeekReasoningEffortSliderProps = CreatedLevelSliderProps<DeepSeekReasoningEffort>;
export type DeepSeekV4GAReasoningEffortSliderProps =
  CreatedLevelSliderProps<DeepSeekV4GAReasoningEffort>;

const DeepSeekReasoningEffortSlider = createLevelSliderComponent<DeepSeekReasoningEffort>({
  configKey: 'deepseekV4ReasoningEffort',
  defaultValue: 'high',
  levels: DEEPSEEK_REASONING_EFFORT_LEVELS,
  style: { minWidth: 180 },
});

export const DeepSeekV4GAReasoningEffortSlider =
  createLevelSliderComponent<DeepSeekV4GAReasoningEffort>({
    configKey: 'deepseekV4GAReasoningEffort',
    defaultValue: 'high',
    levels: DEEPSEEK_V4_GA_REASONING_EFFORT_LEVELS,
    style: { minWidth: 220 },
  });

export default DeepSeekReasoningEffortSlider;
