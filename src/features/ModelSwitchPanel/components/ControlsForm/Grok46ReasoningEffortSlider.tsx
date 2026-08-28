import { type CreatedLevelSliderProps } from './createLevelSlider';
import { createLevelSliderComponent } from './createLevelSlider';

// Grok 4.6 reasoning is always on: low/medium/high/xhigh (no 'none'), default high.
const GROK4_6_REASONING_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh'] as const;
type Grok46ReasoningEffort = (typeof GROK4_6_REASONING_EFFORT_LEVELS)[number];

export type Grok46ReasoningEffortSliderProps = CreatedLevelSliderProps<Grok46ReasoningEffort>;

const Grok46ReasoningEffortSlider = createLevelSliderComponent<Grok46ReasoningEffort>({
  configKey: 'grok4_6ReasoningEffort',
  defaultValue: 'high',
  levels: GROK4_6_REASONING_EFFORT_LEVELS,
  style: { minWidth: 200 },
});

export default Grok46ReasoningEffortSlider;
