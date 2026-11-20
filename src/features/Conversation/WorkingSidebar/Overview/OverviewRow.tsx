import { Flexbox, Icon, type IconProps } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronRightIcon, ChevronsUpDownIcon } from 'lucide-react';
import { memo, type ReactNode } from 'react';

import { useDensityTokens } from '@/styles/density';
import { sidebarRow } from '@/styles/density.stylex';
import { sx } from '@/styles/sx';

import { overviewRowMarker } from './markers.stylex';

export const rowStyles = stylex.create({
  actions: {
    position: 'absolute',
    insetBlockStart: '50%',
    insetInlineEnd: '2px',
    transform: 'translateY(-50%)',
    display: 'flex',
    gap: '2px',
    alignItems: 'center',
    opacity: {
      'default': 0,
      [stylex.when.ancestor(':hover', overviewRowMarker)]: 1,
      [stylex.when.ancestor(':focus-within', overviewRowMarker)]: 1,
      ':has([aria-expanded="true"])': 1,
    },
    pointerEvents: {
      'default': 'none',
      [stylex.when.ancestor(':hover', overviewRowMarker)]: 'auto',
      [stylex.when.ancestor(':focus-within', overviewRowMarker)]: 'auto',
      ':has([aria-expanded="true"])': 'auto',
    },
    transition: 'opacity 0.12s ease',
  },
  changeAdditions: { fontVariantNumeric: 'tabular-nums', color: cssVar.colorSuccess },
  changeDeletions: { fontVariantNumeric: 'tabular-nums', color: cssVar.colorError },
  icon: { flexShrink: 0, color: cssVar.colorTextTertiary },
  iconBox: {
    display: 'grid',
    flexShrink: 0,
    placeItems: 'center',
    width: sidebarRow.iconBox,
    height: sidebarRow.iconBox,
    color: cssVar.colorTextTertiary,
  },
  num: {
    marginInlineEnd: '5px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    fontWeight: 500,
    color: cssVar.colorTextTertiary,
  },
  row: {
    cursor: 'pointer',
    position: 'relative',
    flexShrink: 0,
    gap: sidebarRow.gap,
    minHeight: sidebarRow.height,
    paddingBlock: 0,
    paddingInline: sidebarRow.paddingInline,
    borderRadius: sidebarRow.radius,
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    transition: 'background-color 0.12s ease',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  rowAction: { fontSize: '12px', fontWeight: 500, color: cssVar.colorTextSecondary },
  rowStatic: {
    cursor: 'default',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorTextSecondary },
    backgroundColor: { 'default': null, ':hover': 'transparent' },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  rowTrailing: {
    display: 'flex',
    flexShrink: 0,
    gap: '6px',
    alignItems: 'center',
    fontSize: sidebarRow.metaFontSize,
    fontVariantNumeric: 'tabular-nums',
    lineHeight: '18px',
    color: cssVar.colorTextTertiary,
  },
  rowTrailingConcealed: {
    visibility: {
      default: null,
      [stylex.when.ancestor(':hover', overviewRowMarker)]: 'hidden',
      [stylex.when.ancestor(':focus-within', overviewRowMarker)]: 'hidden',
    },
  },
  rowValue: {
    overflow: 'hidden',
    flex: '1',
    minWidth: '0',
    fontSize: sidebarRow.textFontSize,
    lineHeight: sidebarRow.textLineHeight,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  rowValueDanger: { color: cssVar.colorError },
});

export interface OverviewRowProps {
  actions?: ReactNode;
  danger?: boolean;
  icon?: IconProps['icon'];
  iconColor?: string;
  iconNode?: ReactNode;
  interactive?: boolean;
  onClick?: () => void;
  spin?: boolean;
  title?: string;
  trailing?: ReactNode;
  value: ReactNode;
}

export const OverviewRow = memo<OverviewRowProps>(
  ({
    actions,
    danger,
    icon,
    iconColor,
    iconNode,
    interactive,
    onClick,
    spin,
    title,
    trailing,
    value,
  }) => {
    const { iconSize } = useDensityTokens();

    return (
      <Flexbox
        horizontal
        align={'center'}
        {...stylex.props(
          rowStyles.row,
          !onClick && !interactive && rowStyles.rowStatic,
          overviewRowMarker,
        )}
        role={onClick || interactive ? 'button' : undefined}
        onClick={onClick}
      >
        <span {...sx(rowStyles.iconBox, iconColor ? { color: iconColor } : undefined)}>
          {iconNode ?? <Icon icon={icon!} size={iconSize} spin={spin} />}
        </span>
        <span
          title={title}
          {...stylex.props(rowStyles.rowValue, danger && rowStyles.rowValueDanger)}
        >
          {value}
        </span>
        {trailing ? (
          <span
            {...stylex.props(rowStyles.rowTrailing, !!actions && rowStyles.rowTrailingConcealed)}
          >
            {trailing}
          </span>
        ) : null}
        {actions ? <span {...stylex.props(rowStyles.actions)}>{actions}</span> : null}
      </Flexbox>
    );
  },
);

OverviewRow.displayName = 'OverviewRow';

export const PickerGlyph = () => (
  <Icon icon={ChevronsUpDownIcon} size={13} style={{ opacity: 0.6 }} />
);
export const ChevronRight = () => (
  <Icon icon={ChevronRightIcon} size={14} style={{ opacity: 0.6 }} />
);
