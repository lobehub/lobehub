'use client';

import type { SelectOptions } from '@lobehub/ui';
import { Flexbox, Icon, Select } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { LucideIcon } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';

const styles = stylex.create({
  option: { display: 'flex', flex: '1', gap: '8px', alignItems: 'flex-start', minWidth: '0' },
  optionDesc: {
    fontSize: '12px',
    lineHeight: '16px',
    color: cssVar.colorTextDescription,
    textWrap: 'pretty',
  },
  optionIcon: {
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    height: '20px',
    color: cssVar.colorTextSecondary,
  },
  optionLabel: { fontSize: '14px', lineHeight: '20px', color: cssVar.colorText },
  popup: { maxWidth: 'calc(100vw - 24px)' },
  trigger: { display: 'flex', flex: '1', gap: '8px', alignItems: 'center', minWidth: '0' },
  triggerLabel: {
    overflow: 'hidden',
    textAlign: 'start',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

export interface PolicyOption<Value extends string> {
  /** Shown under the label inside the popup — also carries the "why is this disabled" reason. */
  desc?: string;
  disabled?: boolean;
  icon: LucideIcon;
  label: string;
  value: Value;
}

interface PolicySelectProps<Value extends string> {
  disabled?: boolean;
  loading?: boolean;
  onChange: (value: Value) => void;
  options: PolicyOption<Value>[];
  value?: Value;
}

/**
 * The one control shape shared by every row of the Agent / Agent Group
 * Permission pages: a two-line option in the popup (what it means), a single
 * compact line once chosen. Keeping every row on one component is what makes
 * "who can do what" read as a single decision rather than unrelated widgets.
 */
const PolicySelectInner = <Value extends string>({
  disabled,
  loading,
  onChange,
  options,
  value,
}: PolicySelectProps<Value>) => {
  const selectOptions = useMemo<SelectOptions<Value>>(
    () =>
      options.map((option) => ({
        disabled: option.disabled,
        label: (
          <span {...stylex.props(styles.option)}>
            <span aria-hidden {...stylex.props(styles.optionIcon)}>
              <Icon icon={option.icon} size={16} />
            </span>
            <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
              <span {...stylex.props(styles.optionLabel)}>{option.label}</span>
              {option.desc ? <span {...stylex.props(styles.optionDesc)}>{option.desc}</span> : null}
            </Flexbox>
          </span>
        ),
        title: option.label,
        value: option.value,
      })),
    [options],
  );

  const labelRender = useCallback(
    ({ value: optionValue }: { value: Value }) => {
      const option = options.find((item) => item.value === optionValue);
      if (!option) return null;

      return (
        <span {...stylex.props(styles.trigger)}>
          <span aria-hidden {...stylex.props(styles.optionIcon)}>
            <Icon icon={option.icon} size={16} />
          </span>
          <span {...stylex.props(styles.triggerLabel)}>{option.label}</span>
        </span>
      );
    },
    [options],
  );

  return (
    <Select
      classNames={{ popup: stylex.props(styles.popup).className }}
      disabled={disabled}
      labelRender={labelRender}
      loading={loading}
      optionRender={(option) => option.label}
      options={selectOptions}
      popupMatchSelectWidth={true}
      style={{ width: '100%' }}
      value={value}
      onChange={(next) => {
        if (typeof next !== 'string' || next === value) return;
        onChange(next as Value);
      }}
    />
  );
};

const PolicySelect = memo(PolicySelectInner) as typeof PolicySelectInner;

export default PolicySelect;
