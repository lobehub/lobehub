import { type CreatedLevelSliderProps } from './createLevelSlider';
import { createLevelSliderComponent } from './createLevelSlider';

const THINKING_LEVELS_2 = ['low', 'high'] as const;
type ThinkingLevel2 = (typeof THINKING_LEVELS_2)[number];

export type ThinkingLevel2SliderProps = CreatedLevelSliderProps<ThinkingLevel2>;

const ThinkingLevel2Slider = createLevelSliderComponent<ThinkingLevel2>({
  configKey: 'thinkingLevel',
  defaultValue: 'high',
  levels: THINKING_LEVELS_2,
  style: { minWidth: 110 },
});

export default ThinkingLevel2Slider;
