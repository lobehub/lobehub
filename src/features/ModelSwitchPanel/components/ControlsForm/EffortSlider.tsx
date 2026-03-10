import { type CreatedLevelSliderProps, createLevelSliderComponent } from './createLevelSlider';

const EFFORT_LEVELS = ['low', 'medium', 'high', 'max'] as const;

type EffortLevel = (typeof EFFORT_LEVELS)[number];

export type EffortSliderProps = CreatedLevelSliderProps<EffortLevel>;

const EffortSlider = createLevelSliderComponent<EffortLevel>({
  configKey: 'effort',
  defaultValue: 'high',
  levels: EFFORT_LEVELS,
  style: { minWidth: 200 },
});

export default EffortSlider;
