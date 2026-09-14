import { Flexbox, Icon, type IconProps } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { ChevronRightIcon, ChevronsUpDownIcon } from 'lucide-react';
import { memo, type ReactNode } from 'react';

export const rowStyles = createStaticStyles(({ css, cssVar }) => ({
  changeAdditions: css`
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorSuccess};
  `,
  changeDeletions: css`
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorError};
  `,
  icon: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextTertiary};
  `,
  num: css`
    margin-inline-end: 5px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextTertiary};
  `,
  row: css`
    cursor: pointer;

    flex-shrink: 0;

    min-height: 32px;
    padding-block: 5px;
    padding-inline: 8px;
    border-radius: 8px;

    transition: background-color 0.12s ease;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  rowAction: css`
    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
  `,
  rowStatic: css`
    cursor: default;

    &:hover {
      background: transparent;
    }
  `,
  rowTrailing: css`
    display: flex;
    flex-shrink: 0;
    gap: 6px;
    align-items: center;

    font-size: 12px;
    font-variant-numeric: tabular-nums;
    line-height: 18px;
    color: ${cssVar.colorTextTertiary};
  `,
  rowValue: css`
    overflow: hidden;
    flex: 1;

    min-width: 0;

    font-size: 13px;
    line-height: 20px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  rowValueDanger: css`
    color: ${cssVar.colorError};
  `,
  rowValueWeak: css`
    font-size: 12.5px;
    color: ${cssVar.colorTextSecondary};
  `,
}));

export interface OverviewRowProps {
  danger?: boolean;
  icon?: IconProps['icon'];
  iconColor?: string;
  iconNode?: ReactNode;
  iconSize?: number;
  interactive?: boolean;
  onClick?: () => void;
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
    title,
    trailing,
    value,
    weak,
  }) => (
    <Flexbox
      horizontal
      align={'center'}
      className={cx(rowStyles.row, !onClick && !interactive && rowStyles.rowStatic)}
      gap={10}
      role={onClick || interactive ? 'button' : undefined}
      onClick={onClick}
    >
      {iconNode ?? (
        <Icon
          className={rowStyles.icon}
          icon={icon!}
          size={iconSize}
          style={iconColor ? { color: iconColor } : undefined}
        />
      )}
      <span
        title={title}
        className={cx(
          rowStyles.rowValue,
          danger && rowStyles.rowValueDanger,
          weak && rowStyles.rowValueWeak,
        )}
      >
        {value}
      </span>
      {trailing ? <span className={rowStyles.rowTrailing}>{trailing}</span> : null}
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
