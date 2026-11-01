import type { CreatedLevelSliderProps } from './createLevelSlider';
import { createLevelSliderComponent } from './createLevelSlider';

const GLM53_REASONING_EFFORT_LEVELS = ['low', 'high', 'max'] as const;
type GLM53ReasoningEffort = (typeof GLM53_REASONING_EFFORT_LEVELS)[number];

export type GLM53ReasoningEffortSliderProps = CreatedLevelSliderProps<GLM53ReasoningEffort>;

const GLM53ReasoningEffortSlider = createLevelSliderComponent<GLM53ReasoningEffort>({
  configKey: 'glm5_3ReasoningEffort',
  defaultValue: 'max',
  levels: GLM53_REASONING_EFFORT_LEVELS,
  style: { minWidth: 200 },
});

export default GLM53ReasoningEffortSlider;
