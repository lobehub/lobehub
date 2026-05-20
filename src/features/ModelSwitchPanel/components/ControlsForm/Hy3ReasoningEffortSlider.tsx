import { type CreatedLevelSliderProps } from './createLevelSlider';
import { createLevelSliderComponent } from './createLevelSlider';

const HY3_REASONING_EFFORT_LEVELS = ['no_think', 'low', 'high'] as const;
type Hy3ReasoningEffort = (typeof HY3_REASONING_EFFORT_LEVELS)[number];

export type Hy3ReasoningEffortSliderProps = CreatedLevelSliderProps<Hy3ReasoningEffort>;

const Hy3ReasoningEffortSlider = createLevelSliderComponent<Hy3ReasoningEffort>({
  configKey: 'hy3ReasoningEffort',
  defaultValue: 'high',
  levels: HY3_REASONING_EFFORT_LEVELS,
  style: { minWidth: 200 },
});

export default Hy3ReasoningEffortSlider;
