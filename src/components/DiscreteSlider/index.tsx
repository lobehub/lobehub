import { Flexbox } from '@lobehub/ui';
import { Slider, type SliderProps, Tooltip } from '@lobehub/ui/base-ui';
import { createStaticStyles, cx } from 'antd-style';
import type { CSSProperties, ReactNode } from 'react';
import { memo, useMemo } from 'react';

import { findClosestOptionIndex } from './utils';

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

    &:disabled {
      cursor: not-allowed;
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
  `,
}));

export interface DiscreteSliderOption {
  ariaLabel?: string;
  label: ReactNode;
  style?: CSSProperties;
  value: number;
}

export interface DiscreteSliderProps extends Omit<
  SliderProps,
  'defaultValue' | 'max' | 'min' | 'onChange' | 'onChangeComplete' | 'step' | 'value'
> {
  formatTooltip?: (value: number) => ReactNode;
  onChange?: (value: number) => void;
  onChangeComplete?: (value: number) => void;
  options: readonly DiscreteSliderOption[];
  value: number;
}

const DiscreteSlider = memo<DiscreteSliderProps>(
  ({
    className,
    disabled,
    formatTooltip,
    onChange,
    onChangeComplete,
    options,
    style,
    value,
    ...rest
  }) => {
    const currentIndex = useMemo(() => findClosestOptionIndex(options, value), [options, value]);
    const currentOption = options[currentIndex];
    const gridTemplateColumns =
      options.length > 1
        ? [
            'minmax(0, 0.5fr)',
            ...Array.from({ length: options.length - 2 }).fill('minmax(0, 1fr)'),
            'minmax(0, 0.5fr)',
          ].join(' ')
        : 'minmax(0, 1fr)';

    const slider = (
      <div className={styles.slider}>
        <Slider
          {...rest}
          disabled={disabled || options.length === 0}
          max={Math.max(0, options.length - 1)}
          min={0}
          step={1}
          value={currentIndex}
          onChange={(index) => {
            const option = options[index];
            if (option) onChange?.(option.value);
          }}
          onChangeComplete={(index) => {
            const option = options[index];
            if (option) onChangeComplete?.(option.value);
          }}
        />
      </div>
    );

    return (
      <Flexbox className={cx(styles.root, className)} gap={6} style={style}>
        {formatTooltip && currentOption ? (
          <Tooltip title={formatTooltip(currentOption.value)}>{slider}</Tooltip>
        ) : (
          slider
        )}
        <div className={styles.labels} style={{ gridTemplateColumns }}>
          {options.map((option, index) => {
            const isFirst = index === 0;
            const isLast = index === options.length - 1;
            const textAlign = isFirst === isLast ? 'center' : isFirst ? 'start' : 'end';

            return (
              <button
                aria-current={index === currentIndex ? 'true' : undefined}
                aria-label={option.ariaLabel}
                className={cx(styles.label, index === currentIndex && styles.selectedLabel)}
                disabled={disabled}
                key={option.value}
                style={{ textAlign, ...option.style }}
                type={'button'}
                onClick={() => onChange?.(option.value)}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </Flexbox>
    );
  },
);

DiscreteSlider.displayName = 'DiscreteSlider';

export default DiscreteSlider;
