import { type CreatedLevelSliderProps } from './createLevelSlider';
import { createLevelSliderComponent } from './createLevelSlider';

const THINKING_LEVELS_4 = ['minimal', 'high'] as const;
type ThinkingLevel4 = (typeof THINKING_LEVELS_4)[number];

export type ThinkingLevel4SliderProps = CreatedLevelSliderProps<ThinkingLevel4>;

const ThinkingLevel4Slider = createLevelSliderComponent<ThinkingLevel4>({
  configKey: 'thinkingLevel',
  defaultValue: 'minimal',
  levels: THINKING_LEVELS_4,
  style: { minWidth: 110 },
});

export default ThinkingLevel4Slider;
