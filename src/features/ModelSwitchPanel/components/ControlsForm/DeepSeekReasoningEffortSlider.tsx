import { type CreatedLevelSliderProps, createLevelSliderComponent } from './createLevelSlider';

const DEEPSEEK_REASONING_EFFORT_LEVELS = ['high', 'max'] as const;

type DeepSeekReasoningEffort = 'high' | 'max';

export type DeepSeekReasoningEffortSliderProps = CreatedLevelSliderProps<DeepSeekReasoningEffort>;

const DeepSeekReasoningEffortSlider = createLevelSliderComponent({
  configKey: 'reasoningEffort',
  defaultValue: 'high' as const,
  levels: DEEPSEEK_REASONING_EFFORT_LEVELS,
  style: { minWidth: 200 },
});

export default DeepSeekReasoningEffortSlider;
