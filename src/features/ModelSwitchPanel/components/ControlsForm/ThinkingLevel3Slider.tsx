import { type CreatedLevelSliderProps } from './createLevelSlider';
import { createLevelSliderComponent } from './createLevelSlider';

const THINKING_LEVELS_3 = ['low', 'medium', 'high'] as const;
type ThinkingLevel3 = (typeof THINKING_LEVELS_3)[number];

export type ThinkingLevel3SliderProps = CreatedLevelSliderProps<ThinkingLevel3>;

const ThinkingLevel3Slider = createLevelSliderComponent<ThinkingLevel3>({
  configKey: 'thinkingLevel',
  defaultValue: 'high',
  levels: THINKING_LEVELS_3,
  style: { minWidth: 160 },
});

export default ThinkingLevel3Slider;
