import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import { groupHeaderMarker, rowHeaderMarker } from '../markers.stylex';

const celebratePop = stylex.keyframes({
  '0%': { opacity: 0, transform: 'scale(0.6)' },
  '60%': { transform: 'scale(1.15)' },
  '100%': { opacity: 1, transform: 'scale(1)' },
});

const compact = '@media (width <= 767px)';
const hoverable = '@media (hover: hover) and (pointer: fine)';
const rowReveal = stylex.keyframes({ from: { opacity: 0 }, to: { opacity: 1 } });

export const styles = stylex.create({
  /**
   * Regions whose evidence a later round replaced. Kept quiet on purpose: it is
   * a footnote to the check, not a second checklist — full-strength cards here
   * competed with the evidence the reader actually came for.
   */
  staleRegions: {
    marginBlockStart: '4px',
    paddingBlock: '10px',
    paddingInlineStart: '12px',
    borderInlineStartWidth: '2px',
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: cssVar.colorBorderSecondary,
    opacity: { 'default': 0.75, ':hover': 1 },
  },
  chip: {
    paddingInline: '6px',
    borderRadius: '4px',
    fontSize: '11px',
    lineHeight: '18px',
    color: cssVar.colorTextTertiary,
    whiteSpace: 'nowrap',
    backgroundColor: cssVar.colorFillTertiary,
  },
  chipClickable: {
    cursor: 'pointer',
    color: { 'default': null, ':hover': cssVar.colorText },
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillSecondary },
  },
  emptyCard: {
    paddingBlock: '48px',
    paddingInline: '16px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgContainer,
  },
  celebrateIcon: {
    animationName: celebratePop,
    animationDuration: '0.45s',
    animationTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    animationFillMode: 'both',
  },
  groupCard: {
    backgroundColor: cssVar.colorBgContainer,
  },
  groupHeader: {
    cursor: 'pointer',
    paddingBlock: '10px',
    paddingInline: '16px',
    backgroundColor: cssVar.colorFillQuaternary,
  },
  groupActions: {
    opacity: { default: 0, [stylex.when.ancestor(':hover', groupHeaderMarker)]: 1 },
    transition: 'opacity 0.2s',
  },
  historyToggle: {
    cursor: 'pointer',
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'center',
    width: 'fit-content',
    fontSize: '12px',
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorText },
  },
  row: {
    borderBlockStartWidth: '1px',
    // The list opens flush with the content above it. Grouped lists are
    // unaffected: their first child is the group header, so rows are never
    // first.
    borderBlockStartStyle: { 'default': 'solid', ':first-child': 'none' },
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  seqChip: {
    flex: 'none',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '11px',
    lineHeight: '22px',
    color: cssVar.colorTextSecondary,
    letterSpacing: '0.02em',
  },
  seqChipClickable: {
    cursor: 'copy',
    color: { 'default': null, ':hover': cssVar.colorText },
  },
  rowActions: {
    height: '22px',
    animationName: rowReveal,
    animationDuration: '0.2s',
    animationFillMode: 'both',
  },
  rowActionsIdle: {
    display: {
      default: null,
      [stylex.when.ancestor(':not(:hover, :focus-within)', rowHeaderMarker)]: 'none',
    },
  },
  rowChevron: {
    gridArea: { default: null, [compact]: '1 / 4' },
  },
  rowMeta: {
    animationName: rowReveal,
    animationDuration: '0.2s',
    animationFillMode: 'both',
    gridArea: { default: null, [compact]: '1 / 3' },
    flexWrap: { default: null, [compact]: 'wrap' },
    justifyContent: { default: null, [compact]: 'flex-end' },
    minWidth: { default: null, [compact]: 0 },
    display: {
      default: null,
      [compact]: { 'default': null, ':empty': 'none' },
      [hoverable]: {
        default: null,
        [stylex.when.ancestor(':not(:hover, :focus-within)', rowHeaderMarker)]: 'none',
      },
    },
  },
  rowTitle: {
    gridArea: { default: null, [compact]: '2 / 1 / auto / -1' },
  },
  rowHeader: {
    cursor: 'pointer',
    paddingBlock: { default: '12px', [compact]: '8px' },
    paddingInline: { default: '16px', [compact]: 0 },
    display: { default: null, [compact]: 'grid' },
    gridTemplateColumns: { default: null, [compact]: '16px max-content minmax(0, 1fr) 14px' },
    rowGap: { default: null, [compact]: '4px' },
  },
  // The hover wash marks the collapsed row as a click target. An OPEN row is
  // in reading mode — a gray band flashing between the white body and the
  // white page just severs the title from its content, so no wash there.
  rowHeaderCollapsed: {
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillQuaternary },
  },
  stepDot: {
    flex: 'none',
    width: '9px',
    height: '9px',
    marginBlockStart: '5px',
    borderWidth: '2px',
    borderStyle: 'solid',
    borderRadius: '50%',
    backgroundColor: cssVar.colorBgContainer,
  },
  stepRail: {
    flex: '1',
    width: '1px',
    marginBlockStart: '6px',
    backgroundColor: cssVar.colorBorderSecondary,
  },
  titleEllipsis: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});
