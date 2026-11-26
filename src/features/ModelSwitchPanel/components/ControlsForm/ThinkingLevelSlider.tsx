import { type CreatedLevelSliderProps } from './createLevelSlider';
import { createLevelSliderComponent } from './createLevelSlider';

const THINKING_LEVELS = ['minimal', 'low', 'medium', 'high'] as const;
type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export type ThinkingLevelSliderProps = CreatedLevelSliderProps<ThinkingLevel>;

const ThinkingLevelSlider = createLevelSliderComponent<ThinkingLevel>({
  configKey: 'thinkingLevel',
  defaultValue: 'high',
  levels: THINKING_LEVELS,
  marks: Object.fromEntries(
    THINKING_LEVELS.map((label, index) => [
      index,
      { label, style: { overflowWrap: 'normal', whiteSpace: 'nowrap' } },
    ]),
  ),
  style: { minWidth: 200 },
});

export default ThinkingLevelSlider;
