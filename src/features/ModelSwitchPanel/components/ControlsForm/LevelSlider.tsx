import { Flexbox, Slider } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { CSSProperties, ReactNode } from 'react';
import { memo, useMemo } from 'react';
import useMergeState from 'use-merge-value';

const styles = stylex.create({
  label: {
    cursor: 'pointer',
    padding: '0',
    borderStyle: 'none',
    font: 'inherit',
    fontSize: '12px',
    lineHeight: '16px',
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorTextSecondary },
    textAlign: 'center',
    overflowWrap: 'anywhere',
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    transition: 'color 0.2s ease',
    borderRadius: { 'default': null, ':focus-visible': '6px' },
    outlineWidth: { 'default': null, ':focus-visible': '1px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorBorder },
    outlineOffset: { 'default': null, ':focus-visible': '2px' },
  },
  labels: { display: 'grid', gap: '8px', width: '100%' },
  root: { width: '100%' },
  selectedLabel: { color: cssVar.colorText },
  slider: { width: '100%', paddingInline: '6px' },
});

export type LevelSliderMark = ReactNode | { label?: ReactNode; style?: CSSProperties };

export interface LevelSliderProps<T extends string = string> {
  /**
   * Default value when uncontrolled
   */
  defaultValue?: T;
  disabled?: boolean;
  /**
   * Ordered array of level values (left to right on slider)
   */
  levels: readonly T[];
  /**
   * Optional custom marks. If not provided, uses level values as marks.
   */
  marks?: Record<number, LevelSliderMark>;
  /**
   * Callback when value changes
   */
  onChange?: (value: T) => void;
  /**
   * Style for the slider container
   */
  style?: CSSProperties;
  /**
   * Controlled value
   */
  value?: T;
}

interface LevelOption<T extends string> {
  label: ReactNode;
  style?: CSSProperties;
  value: T;
}

const getMinimumWidth = (levelCount: number, customMinWidth: CSSProperties['minWidth']) => {
  const minimumWidth = levelCount >= 5 ? 260 : levelCount === 4 ? 220 : 180;

  if (customMinWidth === undefined) return minimumWidth;

  return typeof customMinWidth === 'number'
    ? Math.max(customMinWidth, minimumWidth)
    : customMinWidth;
};

const resolveMark = (
  mark: LevelSliderMark | undefined,
  fallback: string,
): { label: ReactNode; style?: CSSProperties } => {
  if (!mark) return { label: fallback };

  if (typeof mark === 'object' && 'label' in mark) {
    return {
      label: mark.label ?? fallback,
      style: mark.style,
    };
  }

  return { label: mark as ReactNode };
};

function LevelSlider<T extends string = string>({
  levels,
  value,
  defaultValue,
  onChange,
  marks: customMarks,
  style,
  disabled,
}: LevelSliderProps<T>) {
  const defaultLevel = defaultValue ?? levels[Math.floor(levels.length / 2)];

  const [currentLevel, setCurrentLevel] = useMergeState<T>(defaultLevel, {
    defaultValue,
    onChange,
    value,
  });

  const options = useMemo(
    () =>
      levels.map<LevelOption<T>>((level, index) => ({
        ...resolveMark(customMarks?.[index], level),
        value: level,
      })),
    [customMarks, levels],
  );

  const currentIndex = levels.indexOf(currentLevel);
  const sliderValue = currentIndex === -1 ? Math.floor(levels.length / 2) : currentIndex;
  const { minWidth: customMinWidth, ...restStyle } = style ?? {};

  // Slider dots sit at i / (n - 1) of the track while equal grid columns center
  // labels at (i + 0.5) / n, so labels drift off their dots (e.g. 'none' / 'max'
  // float away from the track ends). Half-width edge columns with start/end
  // alignment pin the first/last labels to the ends and center the middle
  // labels exactly under their dots.
  const gridTemplateColumns =
    levels.length > 1
      ? [
          'minmax(0, 0.5fr)',
          ...Array.from({ length: levels.length - 2 }).fill('minmax(0, 1fr)'),
          'minmax(0, 0.5fr)',
        ].join(' ')
      : 'minmax(0, 1fr)';

  const handleChange = (index: number) => {
    if (disabled) return;

    const newLevel = levels[index];
    if (newLevel !== undefined) {
      setCurrentLevel(newLevel);
    }
  };

  return (
    <Flexbox
      className={stylex.props(styles.root).className}
      gap={8}
      style={{
        ...restStyle,
        minWidth: getMinimumWidth(levels.length, customMinWidth),
        width: '100%',
      }}
    >
      <div {...stylex.props(styles.slider)}>
        <Slider
          disabled={disabled}
          max={levels.length - 1}
          min={0}
          step={1}
          value={sliderValue}
          onChange={handleChange}
        />
      </div>
      <div className={stylex.props(styles.labels).className} style={{ gridTemplateColumns }}>
        {options.map((option, index) => {
          const selected = index === sliderValue;
          const isFirst = index === 0;
          const isLast = index === levels.length - 1;
          const textAlign = isFirst === isLast ? 'center' : isFirst ? 'start' : 'end';

          return (
            <button
              aria-current={selected ? 'true' : undefined}
              className={stylex.props(styles.label, selected && styles.selectedLabel).className}
              disabled={disabled}
              key={option.value}
              style={{ textAlign, ...option.style }}
              type="button"
              onClick={() => {
                if (disabled) return;
                setCurrentLevel(option.value);
              }}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </Flexbox>
  );
}

export default memo(LevelSlider) as typeof LevelSlider;
