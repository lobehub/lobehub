'use client';

import { Flexbox, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { type KeyboardEvent, memo } from 'react';

const styles = stylex.create({
  dot: {
    borderColor: cssVar.colorBorder,
    borderRadius: '50%',
    borderStyle: 'solid',
    borderWidth: 1.5,
    flexShrink: 0,
    height: 16,
    marginBlockStart: 2,
    width: 16,
  },
  dotOn: {
    borderColor: cssVar.colorPrimary,
    borderWidth: 5,
  },
  group: {
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
    marginInline: -12,
    width: 'calc(100% + 24px)',
  },
  row: {
    alignItems: 'flex-start',
    backgroundColor: {
      ':hover': cssVar.colorFillQuaternary,
      'default': 'transparent',
    },
    borderRadius: cssVar.borderRadius,
    borderWidth: 0,
    columnGap: 12,
    cursor: 'pointer',
    display: 'flex',
    paddingBlock: 8,
    paddingInline: 12,
    textAlign: 'start',
    width: '100%',
  },
  rowDisabled: {
    cursor: 'not-allowed',
    opacity: 0.5,
  },
  rowOn: {
    backgroundColor: cssVar.colorFillTertiary,
  },
});

export interface ChoiceOption<T extends string> {
  desc?: string;
  label: string;
  /** Marks the option the product suggests; shown as a small tag. */
  recommendedLabel?: string;
  value: T;
}

interface ChoiceListProps<T extends string> {
  'aria-label'?: string;
  'disabled'?: boolean;
  'onChange': (value: T) => void;
  'options': ChoiceOption<T>[];
  'value': T;
}

/**
 * A short single-choice list where every option states what it does. Used
 * where a dropdown would hide the consequences: the options are few and each
 * one needs a sentence. Behaves as a radio group, including arrow keys.
 */
const ChoiceListInner = <T extends string>({
  'aria-label': ariaLabel,
  disabled,
  onChange,
  options,
  value,
}: ChoiceListProps<T>) => {
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step =
      event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? 1
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? -1
          : 0;
    if (!step || disabled) return;

    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    onChange(options[next].value);
    (
      event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="radio"]')[next] ??
      undefined
    )?.focus();
  };

  return (
    <div aria-label={ariaLabel} role="radiogroup" {...stylex.props(styles.group)}>
      {options.map((option, index) => {
        const on = option.value === value;

        return (
          <button
            aria-checked={on}
            disabled={disabled}
            key={option.value}
            role="radio"
            tabIndex={on ? 0 : -1}
            type="button"
            {...stylex.props(styles.row, on && styles.rowOn, disabled && styles.rowDisabled)}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            <span {...stylex.props(styles.dot, on && styles.dotOn)} />
            <Flexbox gap={2} style={{ minWidth: 0 }}>
              <Flexbox horizontal align={'center'} gap={8}>
                <Text weight={500}>{option.label}</Text>
                {option.recommendedLabel && (
                  <Tag color={'blue'} size={'small'}>
                    {option.recommendedLabel}
                  </Tag>
                )}
              </Flexbox>
              {option.desc && (
                <Text fontSize={12} type={'secondary'}>
                  {option.desc}
                </Text>
              )}
            </Flexbox>
          </button>
        );
      })}
    </div>
  );
};

export const ChoiceList = memo(ChoiceListInner) as typeof ChoiceListInner;
