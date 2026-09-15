import type { CreatedLevelSliderProps } from './createLevelSlider';
import { createLevelSliderComponent } from './createLevelSlider';

/**
 * GPT-6 Astra dropped `none` — its lowest reasoning effort is `low`.
 *
 * @see https://developers.openai.com/docs/models/gpt-6-astra
 */
const GPT6_REASONING_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
type GPT6ReasoningEffort = (typeof GPT6_REASONING_EFFORT_LEVELS)[number];

export type GPT6ReasoningEffortSliderProps = CreatedLevelSliderProps<GPT6ReasoningEffort>;

export const GPT6ReasoningEffortSlider = createLevelSliderComponent<GPT6ReasoningEffort>({
  configKey: 'gpt6ReasoningEffort',
  defaultValue: 'medium',
  levels: GPT6_REASONING_EFFORT_LEVELS,
  style: { minWidth: 270 },
});
