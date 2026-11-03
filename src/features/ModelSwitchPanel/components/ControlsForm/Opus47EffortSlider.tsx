import { type CreatedLevelSliderProps, createLevelSliderComponent } from './createLevelSlider';

const OPUS47_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

type Opus47Effort = (typeof OPUS47_EFFORT_LEVELS)[number];

export type Opus47EffortSliderProps = CreatedLevelSliderProps<Opus47Effort>;

const Opus47EffortSlider = createLevelSliderComponent<Opus47Effort>({
  configKey: 'opus47Effort',
  defaultValue: 'high',
  levels: OPUS47_EFFORT_LEVELS,
  style: { minWidth: 200 },
});

export default Opus47EffortSlider;
