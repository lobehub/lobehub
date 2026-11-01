import { type CreatedLevelSliderProps } from './createLevelSlider';
import { createLevelSliderComponent } from './createLevelSlider';

/** Grok 4.7 has no off setting. See https://docs.x.ai/developers/model-capabilities/text/reasoning */
const GROK4_7_REASONING_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh'] as const;
type Grok47ReasoningEffort = (typeof GROK4_7_REASONING_EFFORT_LEVELS)[number];

export type Grok47ReasoningEffortSliderProps = CreatedLevelSliderProps<Grok47ReasoningEffort>;

const Grok47ReasoningEffortSlider = createLevelSliderComponent<Grok47ReasoningEffort>({
  configKey: 'grok4_7ReasoningEffort',
  defaultValue: 'high',
  levels: GROK4_7_REASONING_EFFORT_LEVELS,
  style: { minWidth: 200 },
});

export default Grok47ReasoningEffortSlider;
