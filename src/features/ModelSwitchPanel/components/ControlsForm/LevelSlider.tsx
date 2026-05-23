import { Flexbox } from '@lobehub/ui';
import { Slider } from 'antd';
import type { SliderSingleProps } from 'antd/es/slider';
import { createStaticStyles, cx } from 'antd-style';
import type { CSSProperties, ReactNode } from 'react';
import { memo, useMemo } from 'react';
import useMergeState from 'use-merge-value';

const styles = createStaticStyles(({ css, cssVar }) => ({
  label: css`
    cursor: pointer;

    padding: 0;
    border: none;

    font: inherit;
    font-size: 12px;
    line-height: 16px;
    color: ${cssVar.colorTextTertiary};
    text-align: center;
    overflow-wrap: anywhere;

    background: transparent;

    transition: color 0.2s ease;

    &:hover {
      color: ${cssVar.colorTextSecondary};
    }

    &:focus-visible {
      border-radius: 6px;
      outline: 1px solid ${cssVar.colorBorder};
      outline-offset: 2px;
    }
  `,
  labels: css`
    display: grid;
    gap: 8px;
    width: 100%;
  `,
  root: css`
    width: 100%;
  `,
  selectedLabel: css`
    color: ${cssVar.colorText};
  `,
  slider: css`
    width: 100%;
    padding-inline: 6px;

    .ant-slider {
      margin-block: 2px 0;
      margin-inline: 0;
    }

    .ant-slider-rail {
      background: ${cssVar.colorFillQuaternary};
    }

    .ant-slider-track {
      background: ${cssVar.colorTextSecondary};
    }

    .ant-slider-dot {
      border-color: ${cssVar.colorTextTertiary};
      background: ${cssVar.colorBgElevated};
    }

    .ant-slider-dot-active {
      border-color: ${cssVar.colorTextSecondary};
    }

    .ant-slider-handle::after {
      background: ${cssVar.colorBgElevated};
      box-shadow: 0 0 0 2px ${cssVar.colorTextSecondary};
    }

    .ant-slider-handle:hover::after,
    .ant-slider-handle:focus::after,
    .ant-slider-handle:active::after {
      box-shadow: 0 0 0 3px ${cssVar.colorTextSecondary};
    }
  `,
}));

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
  mark: NonNullable<SliderSingleProps['marks']>[number] | undefined,
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

  const handleChange = (index: number) => {
    const newLevel = levels[index];
    if (newLevel !== undefined) {
      setCurrentLevel(newLevel);
    }
  };

  return (
    <Flexbox
      className={styles.root}
      gap={8}
      style={{
        ...restStyle,
        minWidth: getMinimumWidth(levels.length, customMinWidth),
        width: '100%',
      }}
    >
      <div className={styles.slider}>
        <Slider
          dots
          max={levels.length - 1}
          min={0}
          step={1}
          tooltip={{ open: false }}
          value={sliderValue}
          onChange={handleChange}
        />
      </div>
      <div
        className={styles.labels}
        style={{ gridTemplateColumns: `repeat(${levels.length}, minmax(0, 1fr))` }}
      >
        {options.map((option, index) => {
          const selected = index === sliderValue;

          return (
            <button
              aria-current={selected ? 'true' : undefined}
              className={cx(styles.label, selected && styles.selectedLabel)}
              key={option.value}
              style={option.style}
              type="button"
              onClick={() => {
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
