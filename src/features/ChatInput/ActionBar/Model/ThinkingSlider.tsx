import { type CreatedLevelSliderProps } from './createLevelSlider';
import { createLevelSliderComponent } from './createLevelSlider';

const THINKING_MODES = ['disabled', 'auto', 'enabled'] as const;
type ThinkingMode = (typeof THINKING_MODES)[number];

// Display marks for the slider
const THINKING_MARKS = {
  0: 'OFF',
  1: 'Auto',
  2: 'ON',
};

export type ThinkingSliderProps = CreatedLevelSliderProps<ThinkingMode>;

const ThinkingSlider = createLevelSliderComponent<ThinkingMode>({
  configKey: 'thinking',
  defaultValue: 'auto',
  levels: THINKING_MODES,
  marks: THINKING_MARKS,
  style: { minWidth: 200 },
});

export default ThinkingSlider;
