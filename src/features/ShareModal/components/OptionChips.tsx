import { type DropdownItem, DropdownMenu, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CheckIcon, ChevronDownIcon, PlusIcon } from 'lucide-react';

const styles = stylex.create({
  chip: {
    cursor: 'pointer',
    display: 'inline-flex',
    flex: 'none',
    gap: '6px',
    alignItems: 'center',
    height: '30px',
    paddingInline: '12px',
    borderWidth: '1px',
    borderStyle: 'dashed',
    borderColor: { 'default': cssVar.colorBorder, ':hover': cssVar.colorTextQuaternary },
    borderRadius: '15px',
    fontSize: '13px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    transition: `background 150ms ${cssVar.motionEaseOut},
      color 150ms ${cssVar.motionEaseOut},
      border-color 150ms ${cssVar.motionEaseOut}`,
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimaryBorder },
    outlineOffset: { 'default': null, ':focus-visible': '1px' },
  },
  chipActive: {
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: { 'default': cssVar.colorText, ':hover': cssVar.colorText },
    color: { 'default': cssVar.colorBgContainer, ':hover': cssVar.colorBgContainer },
    backgroundColor: cssVar.colorText,
    backgroundImage: 'none',
    opacity: { 'default': null, ':hover': 0.88 },
  },
  select: {
    cursor: 'pointer',
    display: 'inline-flex',
    flex: 'none',
    gap: '6px',
    alignItems: 'center',
    height: '30px',
    paddingInline: '10px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorder,
    borderRadius: cssVar.borderRadius,
    fontSize: '13px',
    color: cssVar.colorText,
    backgroundColor: { 'default': cssVar.colorBgContainer, ':hover': cssVar.colorFillQuaternary },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimaryBorder },
    outlineOffset: { 'default': null, ':focus-visible': '1px' },
  },
  selectLabel: { color: cssVar.colorTextDescription },
});

interface ToggleChipProps {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}

export const ToggleChip = ({ checked, label, onChange }: ToggleChipProps) => (
  <button
    aria-pressed={checked}
    {...stylex.props(styles.chip, checked && styles.chipActive)}
    type={'button'}
    onClick={() => onChange(!checked)}
  >
    <Icon icon={checked ? CheckIcon : PlusIcon} size={14} />
    {label}
  </button>
);

interface SelectChipOption<T extends string> {
  label: string;
  value: T;
}

interface SelectChipProps<T extends string> {
  label: string;
  onChange: (value: T) => void;
  options: SelectChipOption<T>[];
  value: T;
}

export const SelectChip = <T extends string>({
  label,
  onChange,
  options,
  value,
}: SelectChipProps<T>) => {
  const items: DropdownItem[] = options.map((option) => ({
    extra: option.value === value ? <Icon icon={CheckIcon} size={14} /> : undefined,
    key: option.value,
    label: option.label,
    onClick: () => onChange(option.value),
  }));

  const current = options.find((option) => option.value === value);

  return (
    <DropdownMenu items={items} placement={'bottomLeft'}>
      <button {...stylex.props(styles.select)} type={'button'}>
        <span {...stylex.props(styles.selectLabel)}>{label}</span>
        {current?.label}
        <Icon icon={ChevronDownIcon} size={14} style={{ opacity: 0.5 }} />
      </button>
    </DropdownMenu>
  );
};
