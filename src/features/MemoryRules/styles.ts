import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import { hoverHostMarker } from './markers.stylex';

/**
 * One sheet, Linear-style: a sticky header row, one hairline per row, group rows that run the
 * full width, and hover-only controls. The grid is shared by the header row and every rule row
 * so the columns line up without a table element.
 */
export const styles = stylex.create({
  body: {
    overflowY: 'auto',
    display: 'flex',
    flex: '1',
  },
  cellId: {
    paddingBlockStart: '2px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
  },
  chevron: {
    display: 'inline-flex',
    color: cssVar.colorTextTertiary,
    transition: 'transform 0.15s',
  },
  chevronOpen: {
    transform: 'rotate(90deg)',
  },
  directionNegative: {
    color: cssVar.colorTextSecondary,
  },
  directionPositive: {
    color: cssVar.colorTextSecondary,
  },
  divider: {
    paddingBlockStart: '22px',
    paddingBlockEnd: '6px',
    paddingInline: '8px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '22px 40px minmax(220px, 2fr) 56px 56px 64px 64px 28px',
    columnGap: '8px',
    alignItems: 'start',
  },
  // Shown while the enclosing row or heading (hoverHostMarker) is hovered.
  hover: {
    opacity: {
      default: 0,
      [stylex.when.ancestor(':hover', hoverHostMarker)]: 1,
    },
    transition: 'opacity 0.15s',
  },
  modeBlock: {
    color: cssVar.colorPrimary,
  },
  modeBtn: {
    cursor: 'pointer',
    userSelect: 'none',
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'center',
    paddingBlock: '1px',
    paddingInline: '6px',
    borderRadius: cssVar.borderRadiusSM,
    fontSize: '12px',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillSecondary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  modeRemind: {
    color: cssVar.colorTextTertiary,
  },
  muted: {
    fontSize: '12px',
    lineHeight: 1.6,
    color: cssVar.colorTextSecondary,
  },
  ownerCount: {
    fontSize: '12px',
    fontWeight: 400,
    color: cssVar.colorTextTertiary,
  },
  row: {
    cursor: 'pointer',
    width: '100%',
    paddingBlock: '10px',
    paddingInline: '8px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
    fontSize: '13px',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillQuaternary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  rowActive: {
    backgroundColor: { 'default': cssVar.colorFillTertiary, ':hover': cssVar.colorFillTertiary },
    backgroundImage: 'none',
  },
  rowArchived: {
    color: cssVar.colorTextTertiary,
  },
  section: {
    cursor: 'pointer',
    userSelect: 'none',
    position: 'relative',
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    height: '34px',
    marginBlockStart: '10px',
    paddingInline: '8px',
    borderRadius: cssVar.borderRadius,
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillQuaternary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  sectionActions: {
    position: 'absolute',
    insetBlockStart: '50%',
    insetInlineEnd: '8px',
    transform: 'translateY(-50%)',
  },
  sectionCollapsed: {
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  sectionCount: {
    fontSize: '12px',
    fontWeight: 400,
    color: cssVar.colorTextTertiary,
  },
  sectionLine: {
    flex: '1',
    height: '1px',
    marginInlineStart: '4px',
    marginInlineEnd: {
      default: '-8px',
      [stylex.when.ancestor(':hover', hoverHostMarker)]: '64px',
    },
    backgroundColor: cssVar.colorBorderSecondary,
    backgroundImage: 'none',
  },
  sectionScope: {
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
  },
  sectionTitle: {
    fontSize: '13px',
    fontWeight: 600,
  },
  sortHeader: {
    cursor: 'pointer',
    userSelect: 'none',
    display: 'inline-flex',
    gap: '2px',
    alignItems: 'center',
    width: 'fit-content',
    padding: 0,
    borderWidth: 0,
    borderRadius: { 'default': null, ':focus-visible': cssVar.borderRadiusSM },
    font: 'inherit',
    color: { 'default': 'inherit', ':hover': cssVar.colorText },
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimaryBorder },
    outlineOffset: { 'default': null, ':focus-visible': '2px' },
  },
  sortHeaderActive: {
    color: cssVar.colorText,
  },
  thead: {
    position: 'sticky',
    zIndex: 1,
    insetBlockStart: 0,
    paddingBlockStart: '6px',
    paddingBlockEnd: '8px',
    paddingInline: '8px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorder,
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  title: {
    fontWeight: 500,
    textWrap: 'pretty',
  },
});
