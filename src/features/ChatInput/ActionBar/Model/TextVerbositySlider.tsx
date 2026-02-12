import { type CreatedLevelSliderProps } from './createLevelSlider';
import { createLevelSliderComponent } from './createLevelSlider';

const TEXT_VERBOSITY_LEVELS = ['low', 'medium', 'high'] as const;
type TextVerbosity = (typeof TEXT_VERBOSITY_LEVELS)[number];

export type TextVerbositySliderProps = CreatedLevelSliderProps<TextVerbosity>;

const TextVerbositySlider = createLevelSliderComponent<TextVerbosity>({
  configKey: 'textVerbosity',
  defaultValue: 'medium',
  levels: TEXT_VERBOSITY_LEVELS,
  style: { minWidth: 160 },
});

export default TextVerbositySlider;
