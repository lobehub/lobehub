import { Icon } from '@lobehub/ui';
import type { DropdownItem } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { CheckIcon } from 'lucide-react';
import type { ReactNode } from 'react';

const styles = createStaticStyles(({ css }) => ({
  // The packaged `extra` slot is styled for keyboard hints, so it defaults to the
  // code font. This one carries a model name, which belongs in the UI font — and
  // `inherit` cannot express that, since this span sits inside that slot.
  value: css`
    font-family: ${cssVar.fontFamily};
  `,
}));

const checkIcon = <Icon icon={CheckIcon} size={16} />;

export interface SelectorOption<T extends string> {
  desc?: string;
  label: string;
  value: T;
}

/**
 * `renderDropdownMenuItems` renders `extra` on submenu rows too, but @lobehub/ui
 * only declares it on leaf items — widen it so the current-value column stays typed.
 */
export type SelectorSubmenuItem = DropdownItem & { extra?: ReactNode };

export const buildSelectorSubmenu = <T extends string>({
  current,
  label,
  onSelect,
  options,
  valueLabel,
}: {
  current: T;
  label: string;
  onSelect: (value: T) => void;
  options: readonly SelectorOption<T>[];
  valueLabel: string;
}): SelectorSubmenuItem => ({
  children: options.map((option) => ({
    closeOnClick: false,
    desc: option.desc,
    extra: current === option.value ? checkIcon : undefined,
    key: `${label}-${option.value}`,
    label: option.label,
    onClick: () => onSelect(option.value),
  })),
  extra: <span className={styles.value}>{valueLabel}</span>,
  key: label,
  label,
  type: 'submenu',
});
