import { Flexbox, Icon, type IconProps } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronRightIcon, ChevronsUpDownIcon } from 'lucide-react';
import { memo, type ReactNode } from 'react';

import { sx } from '@/styles/sx';

export const rowStyles = stylex.create({
  changeAdditions: { fontVariantNumeric: 'tabular-nums', color: cssVar.colorSuccess },
  changeDeletions: { fontVariantNumeric: 'tabular-nums', color: cssVar.colorError },
  icon: { flexShrink: 0, color: cssVar.colorTextTertiary },
  num: {
    marginInlineEnd: '5px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    fontWeight: 500,
    color: cssVar.colorTextTertiary,
  },
  row: {
    cursor: 'pointer',
    flexShrink: 0,
    minHeight: '32px',
    paddingBlock: '5px',
    paddingInline: '8px',
    borderRadius: '8px',
    transition: 'background-color 0.12s ease',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  rowAction: { fontSize: '12px', fontWeight: 500, color: cssVar.colorTextSecondary },
  rowStatic: {
    cursor: 'default',
    backgroundColor: { 'default': null, ':hover': 'transparent' },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  rowTrailing: {
    display: 'flex',
    flexShrink: 0,
    gap: '6px',
    alignItems: 'center',
    fontSize: '12px',
    fontVariantNumeric: 'tabular-nums',
    lineHeight: '18px',
    color: cssVar.colorTextTertiary,
  },
  rowValue: {
    overflow: 'hidden',
    flex: '1',
    minWidth: '0',
    fontSize: '13px',
    lineHeight: '20px',
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  rowValueDanger: { color: cssVar.colorError },
  rowValueWeak: { fontSize: '12.5px', color: cssVar.colorTextSecondary },
});

export interface OverviewRowProps {
  danger?: boolean;
  icon?: IconProps['icon'];
  iconColor?: string;
  iconNode?: ReactNode;
  iconSize?: number;
  interactive?: boolean;
  onClick?: () => void;
  spin?: boolean;
  title?: string;
  trailing?: ReactNode;
  value: ReactNode;
  weak?: boolean;
}

export const OverviewRow = memo<OverviewRowProps>(
  ({
    danger,
    icon,
    iconColor,
    iconNode,
    iconSize = 16,
    interactive,
    onClick,
    spin,
    title,
    trailing,
    value,
    weak,
  }) => (
    <Flexbox
      horizontal
      align={'center'}
      {...stylex.props(rowStyles.row, !onClick && !interactive && rowStyles.rowStatic)}
      gap={10}
      role={onClick || interactive ? 'button' : undefined}
      onClick={onClick}
    >
      {iconNode ?? (
        <Icon
          icon={icon!}
          size={iconSize}
          spin={spin}
          {...sx([rowStyles.icon], undefined, iconColor ? { color: iconColor } : undefined)}
        />
      )}
      <span
        title={title}
        {...stylex.props(
          rowStyles.rowValue,
          danger && rowStyles.rowValueDanger,
          weak && rowStyles.rowValueWeak,
        )}
      >
        {value}
      </span>
      {trailing ? <span {...stylex.props(rowStyles.rowTrailing)}>{trailing}</span> : null}
    </Flexbox>
  ),
);

OverviewRow.displayName = 'OverviewRow';

export const PickerGlyph = () => (
  <Icon icon={ChevronsUpDownIcon} size={13} style={{ opacity: 0.6 }} />
);
export const ChevronRight = () => (
  <Icon icon={ChevronRightIcon} size={14} style={{ opacity: 0.6 }} />
);
