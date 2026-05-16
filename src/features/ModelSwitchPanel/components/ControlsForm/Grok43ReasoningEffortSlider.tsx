import { type CreatedLevelSliderProps } from './createLevelSlider';
import { createLevelSliderComponent } from './createLevelSlider';

const GROK4_3_REASONING_EFFORT_LEVELS = ['none', 'low', 'medium', 'high'] as const;
type Grok43ReasoningEffort = (typeof GROK4_3_REASONING_EFFORT_LEVELS)[number];

export type Grok43ReasoningEffortSliderProps = CreatedLevelSliderProps<Grok43ReasoningEffort>;

const Grok43ReasoningEffortSlider = createLevelSliderComponent<Grok43ReasoningEffort>({
  configKey: 'grok4_3ReasoningEffort',
  defaultValue: 'low',
  levels: GROK4_3_REASONING_EFFORT_LEVELS,
  style: { minWidth: 200 },
});

export default Grok43ReasoningEffortSlider;
