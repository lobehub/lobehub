import { type CreatedLevelSliderProps } from './createLevelSlider';
import { createLevelSliderComponent } from './createLevelSlider';

const REASONING_EFFORT_LEVELS = ['low', 'medium', 'high'] as const;
type ReasoningEffort = (typeof REASONING_EFFORT_LEVELS)[number];

export type ReasoningEffortSliderProps = CreatedLevelSliderProps<ReasoningEffort>;

const ReasoningEffortSlider = createLevelSliderComponent<ReasoningEffort>({
  configKey: 'reasoningEffort',
  defaultValue: 'medium',
  levels: REASONING_EFFORT_LEVELS,
  style: { minWidth: 200 },
});

export default ReasoningEffortSlider;
