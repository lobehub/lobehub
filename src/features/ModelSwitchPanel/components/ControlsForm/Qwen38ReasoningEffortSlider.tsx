import type { CreatedLevelSliderProps } from './createLevelSlider';
import { createLevelSliderComponent } from './createLevelSlider';

const QWEN38_REASONING_EFFORT_LEVELS = ['none', 'low', 'medium', 'xhigh'] as const;

type Qwen38ReasoningEffort = (typeof QWEN38_REASONING_EFFORT_LEVELS)[number];

export type Qwen38ReasoningEffortSliderProps = CreatedLevelSliderProps<Qwen38ReasoningEffort>;

const Qwen38ReasoningEffortSlider = createLevelSliderComponent<Qwen38ReasoningEffort>({
  configKey: 'qwen38ReasoningEffort',
  defaultValue: 'xhigh',
  levels: QWEN38_REASONING_EFFORT_LEVELS,
  style: { minWidth: 200 },
});

export default Qwen38ReasoningEffortSlider;
