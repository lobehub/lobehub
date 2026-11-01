import { Flexbox } from '@lobehub/ui';
import { Slider, type SliderProps, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { CSSProperties, ReactNode } from 'react';
import { memo, useMemo } from 'react';

import { sx } from '@/styles/sx';

import { findClosestOptionIndex } from './utils';

const styles = stylex.create({
  label: {
    cursor: { 'default': 'pointer', ':disabled': 'not-allowed' },
    padding: '0',
    borderStyle: 'none',
    fontFamily: 'inherit',
    fontStyle: 'inherit',
    fontWeight: 'inherit',
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
  // `.label:hover` outranked `.selectedLabel` in the emotion cascade, so a selected label
  // still dims to the secondary colour on hover.
  selectedLabel: {
    color: { 'default': cssVar.colorText, ':hover': cssVar.colorTextSecondary },
  },
  slider: { width: '100%', paddingInline: '6px' },
});

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
      <div {...stylex.props(styles.slider)}>
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
      <Flexbox gap={6} {...sx([styles.root], className, style)}>
        {formatTooltip && currentOption ? (
          <Tooltip title={formatTooltip(currentOption.value)}>{slider}</Tooltip>
        ) : (
          slider
        )}
        <div {...sx([styles.labels], undefined, { gridTemplateColumns })}>
          {options.map((option, index) => {
            const isFirst = index === 0;
            const isLast = index === options.length - 1;
            const textAlign = isFirst === isLast ? 'center' : isFirst ? 'start' : 'end';

            return (
              <button
                aria-current={index === currentIndex ? 'true' : undefined}
                aria-label={option.ariaLabel}
                disabled={disabled}
                key={option.value}
                {...sx([styles.label, index === currentIndex && styles.selectedLabel], undefined, {
                  textAlign,
                  ...option.style,
                })}
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
