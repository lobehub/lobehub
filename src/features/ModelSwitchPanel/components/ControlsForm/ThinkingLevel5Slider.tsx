import { type CreatedLevelSliderProps } from './createLevelSlider';
import { createLevelSliderComponent } from './createLevelSlider';

/**
 * Gemini 4 Hydrogen adds `xhigh` above `high` and rejects `minimal`.
 * See https://ai.google.dev/gemini-api/docs/whats-new-gemini-4-hydrogen
 */
const THINKING_LEVELS_5 = ['low', 'medium', 'high', 'xhigh'] as const;
type ThinkingLevel5 = (typeof THINKING_LEVELS_5)[number];

export type ThinkingLevel5SliderProps = CreatedLevelSliderProps<ThinkingLevel5>;

const ThinkingLevel5Slider = createLevelSliderComponent<ThinkingLevel5>({
  configKey: 'thinkingLevel5',
  defaultValue: 'high',
  levels: THINKING_LEVELS_5,
  style: { minWidth: 200 },
});

export default ThinkingLevel5Slider;
