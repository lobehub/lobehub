import { Flexbox } from '@lobehub/ui';
import { Slider } from 'antd';
import { type SliderSingleProps } from 'antd/es/slider';
import { memo, useMemo } from 'react';
import useMergeState from 'use-merge-value';

export interface LevelSliderProps<T extends string = string> {
  /**
   * Default value when uncontrolled
   */
  defaultValue?: T;
  /**
   * Ordered array of level values (left to right on slider)
   */
  levels: readonly T[];
  /**
   * Optional custom marks. If not provided, uses level values as marks.
   */
  marks?: SliderSingleProps['marks'];
  /**
   * Minimum width of the slider container
   */
  minWidth?: number;
  /**
   * Callback when value changes
   */
  onChange?: (value: T) => void;
  /**
   * Controlled value
   */
  value?: T;
}

function LevelSlider<T extends string = string>({
  levels,
  value,
  defaultValue,
  onChange,
  marks: customMarks,
  minWidth = 200,
}: LevelSliderProps<T>) {
  const defaultLevel = defaultValue ?? levels[Math.floor(levels.length / 2)];

  const [currentLevel, setCurrentLevel] = useMergeState<T>(defaultLevel, {
    defaultValue,
    onChange,
    value,
  });

  const marks = useMemo(() => {
    if (customMarks) return customMarks;
    const result: SliderSingleProps['marks'] = {};
    levels.forEach((level, index) => {
      result[index] = level;
    });
    return result;
  }, [customMarks, levels]);

  const currentIndex = levels.indexOf(currentLevel);
  const sliderValue = currentIndex === -1 ? Math.floor(levels.length / 2) : currentIndex;

  const handleChange = (index: number) => {
    const newLevel = levels[index];
    if (newLevel !== undefined) {
      setCurrentLevel(newLevel);
    }
  };

  return (
    <Flexbox
      align={'center'}
      gap={12}
      horizontal
      paddingInline={'0 20px'}
      style={{ minWidth, width: '100%' }}
    >
      <Flexbox flex={1}>
        <Slider
          marks={marks}
          max={levels.length - 1}
          min={0}
          onChange={handleChange}
          step={1}
          tooltip={{ open: false }}
          value={sliderValue}
        />
      </Flexbox>
    </Flexbox>
  );
}

export default memo(LevelSlider) as typeof LevelSlider;
