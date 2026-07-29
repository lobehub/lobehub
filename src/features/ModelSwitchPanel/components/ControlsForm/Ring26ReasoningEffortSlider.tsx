import { type CreatedLevelSliderProps } from './createLevelSlider';
import { createLevelSliderComponent } from './createLevelSlider';

const RING2_6_REASONING_EFFORT_LEVELS = ['high', 'xhigh'] as const;
type Ring26ReasoningEffort = (typeof RING2_6_REASONING_EFFORT_LEVELS)[number];

export type Ring26ReasoningEffortSliderProps = CreatedLevelSliderProps<Ring26ReasoningEffort>;

const Ring26ReasoningEffortSlider = createLevelSliderComponent<Ring26ReasoningEffort>({
  configKey: 'ring2_6ReasoningEffort',
  defaultValue: 'high',
  levels: RING2_6_REASONING_EFFORT_LEVELS,
  style: { minWidth: 200 },
});

export default Ring26ReasoningEffortSlider;
