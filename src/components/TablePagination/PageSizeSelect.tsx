'use client';

import { Select } from '@lobehub/ui/base-ui';
import { memo, type ReactNode } from 'react';

interface PageSizeOption {
  label?: ReactNode;
  value: number;
}

interface PageSizeSelectProps {
  className?: string;
  disabled?: boolean;
  onChange?: (value: number) => void;
  options: PageSizeOption[];
  value?: number;
}

/** The "N / page" picker in the table footer. */
const PageSizeSelect = memo<PageSizeSelectProps>(
  ({ className, disabled, onChange, options, value }) => (
    <Select
      className={className}
      disabled={disabled}
      size={'small'}
      value={value}
      variant={'filled'}
      options={options.map((option) => ({
        label: option.label ?? String(option.value),
        value: option.value,
      }))}
      onChange={(next) => {
        if (typeof next === 'number') onChange?.(next);
      }}
    />
  ),
);

PageSizeSelect.displayName = 'TablePageSizeSelect';

export default PageSizeSelect;
