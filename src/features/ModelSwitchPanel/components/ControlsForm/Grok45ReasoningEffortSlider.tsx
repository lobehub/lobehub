import { type CreatedLevelSliderProps } from './createLevelSlider';
import { createLevelSliderComponent } from './createLevelSlider';

// Grok 4.5 reasoning is always on: low/medium/high (no 'none'), default high.
const GROK4_5_REASONING_EFFORT_LEVELS = ['low', 'medium', 'high'] as const;
type Grok45ReasoningEffort = (typeof GROK4_5_REASONING_EFFORT_LEVELS)[number];

export type Grok45ReasoningEffortSliderProps = CreatedLevelSliderProps<Grok45ReasoningEffort>;

const Grok45ReasoningEffortSlider = createLevelSliderComponent<Grok45ReasoningEffort>({
  configKey: 'grok4_5ReasoningEffort',
  defaultValue: 'high',
  levels: GROK4_5_REASONING_EFFORT_LEVELS,
  style: { minWidth: 200 },
});

export default Grok45ReasoningEffortSlider;
