import type { CreatedLevelSliderProps } from './createLevelSlider';
import { createLevelSliderComponent } from './createLevelSlider';

const GLM52_REASONING_EFFORT_LEVELS = ['high', 'max'] as const;
type GLM52ReasoningEffort = (typeof GLM52_REASONING_EFFORT_LEVELS)[number];

export type GLM52ReasoningEffortSliderProps = CreatedLevelSliderProps<GLM52ReasoningEffort>;

const GLM52ReasoningEffortSlider = createLevelSliderComponent<GLM52ReasoningEffort>({
  configKey: 'glm5_2ReasoningEffort',
  defaultValue: 'max',
  levels: GLM52_REASONING_EFFORT_LEVELS,
  style: { minWidth: 160 },
});

export default GLM52ReasoningEffortSlider;
