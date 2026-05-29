import { type CreatedLevelSliderProps } from './createLevelSlider';
import { createLevelSliderComponent } from './createLevelSlider';

const STEP3_5_REASONING_EFFORT_LEVELS = ['low', 'high'] as const;
type Step3_5ReasoningEffort = (typeof STEP3_5_REASONING_EFFORT_LEVELS)[number];

export type Step3_5ReasoningEffortSliderProps = CreatedLevelSliderProps<Step3_5ReasoningEffort>;

const Step3_5ReasoningEffortSlider = createLevelSliderComponent<Step3_5ReasoningEffort>({
  configKey: 'step3_5ReasoningEffort',
  defaultValue: 'low',
  levels: STEP3_5_REASONING_EFFORT_LEVELS,
  style: { minWidth: 200 },
});

export default Step3_5ReasoningEffortSlider;
