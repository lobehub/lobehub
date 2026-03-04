import { type CreatedLevelSliderProps } from './createLevelSlider';
import { createLevelSliderComponent } from './createLevelSlider';

const THINKING_LEVELS_5 = ['minimal', 'low', 'medium', 'high'] as const;
type ThinkingLevel5 = (typeof THINKING_LEVELS_5)[number];

export type ThinkingLevel5SliderProps = CreatedLevelSliderProps<ThinkingLevel5>;

const ThinkingLevel5Slider = createLevelSliderComponent<ThinkingLevel5>({
  configKey: 'thinkingLevel',
  defaultValue: 'minimal',
  levels: THINKING_LEVELS_5,
  style: { minWidth: 200 },
});

export default ThinkingLevel5Slider;
