import { type CreatedLevelSliderProps } from './createLevelSlider';
import { createLevelSliderComponent } from './createLevelSlider';

const GROK4_20_REASONING_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh'] as const;
type Grok420ReasoningEffort = (typeof GROK4_20_REASONING_EFFORT_LEVELS)[number];

export type Grok420ReasoningEffortSliderProps = CreatedLevelSliderProps<Grok420ReasoningEffort>;

const Grok420ReasoningEffortSlider = createLevelSliderComponent<Grok420ReasoningEffort>({
  configKey: 'grok4_20ReasoningEffort',
  defaultValue: 'medium',
  levels: GROK4_20_REASONING_EFFORT_LEVELS,
  style: { minWidth: 200 },
});

export default Grok420ReasoningEffortSlider;
