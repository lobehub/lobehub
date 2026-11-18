import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import { rowHeaderMarker } from '../markers.stylex';

const compact = '@media (width <= 767px)';
const wideRow = '@container (inline-size >= 720px)';
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
    fontSize: '12px',
    lineHeight: '20px',
    color: cssVar.colorTextTertiary,
    whiteSpace: 'nowrap',
    backgroundColor: cssVar.colorFillTertiary,
  },
  chipClickable: {
    cursor: 'pointer',
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorText },
    backgroundColor: { 'default': cssVar.colorFillTertiary, ':hover': cssVar.colorFillSecondary },
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    alignItems: 'flex-start',
    paddingBlock: '24px',
    paddingInline: '16px',
  },
  emptyTitle: {
    fontSize: '14px',
    fontWeight: 500,
    lineHeight: '22px',
    color: cssVar.colorText,
  },
  emptyDesc: {
    marginBlockEnd: '8px',
    fontSize: '12px',
    lineHeight: '20px',
    color: cssVar.colorTextSecondary,
  },
  sectionHeader: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    paddingBlockStart: '20px',
    paddingBlockEnd: '8px',
    paddingInline: { default: '16px', [compact]: 0 },
    fontSize: '12px',
    lineHeight: '20px',
    fontWeight: 500,
    color: cssVar.colorTextSecondary,
  },
  sectionCount: {
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 400,
    color: cssVar.colorTextTertiary,
  },
  groupCard: {
    backgroundColor: cssVar.colorBgContainer,
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
    containerType: 'inline-size',
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
    fontSize: '12px',
    lineHeight: '22px',
    color: cssVar.colorTextSecondary,
    letterSpacing: '0.02em',
  },
  seqChipClickable: {
    cursor: 'copy',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
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
      [stylex.when.ancestor(':not([data-expanded], :hover, :focus-within)', rowHeaderMarker)]:
        'none',
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
    },
  },
  decision: {
    display: 'inline-flex',
    flex: 'none',
    gap: '4px',
    alignItems: 'center',
    minWidth: { default: '88px', [compact]: 0 },
    fontSize: '12px',
    lineHeight: '20px',
    color: cssVar.colorTextSecondary,
    whiteSpace: 'nowrap',
  },
  decisionAccepted: { color: cssVar.colorSuccessText },
  decisionNeedsFix: { color: cssVar.colorErrorText },
  decisionNotRun: { color: cssVar.colorTextTertiary },
  titleSettled: { color: cssVar.colorTextSecondary },
  body: {
    display: 'grid',
    gridTemplateColumns: { default: 'minmax(0, 1fr)', [wideRow]: 'minmax(0, 1fr) 280px' },
    columnGap: '24px',
    rowGap: '12px',
  },
  bodySingle: {
    gridTemplateColumns: 'minmax(0, 560px)',
  },
  // A row opened in the list gives the evidence the full width — a side-by-side
  // before/after shrank to half its size beside the 280px judging column — and
  // the judging folds into one bar under it.
  bodyStacked: {
    gridTemplateColumns: 'minmax(0, 1fr)',
  },
  verdictBar: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    minWidth: 0,
    paddingBlock: '12px',
    paddingInline: '14px',
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
  },
  verdictLine: {
    display: 'flex',
    gap: '12px',
    alignItems: 'flex-start',
    minWidth: 0,
  },
  verdictLabel: {
    display: 'inline-flex',
    flex: 'none',
    gap: '6px',
    alignItems: 'center',
    height: '22px',
  },
  verdictReason: {
    flex: '1',
    minWidth: 0,
    paddingBlockStart: '1px',
  },
  bodyInList: {
    paddingBlockEnd: '16px',
    paddingInlineStart: { default: '16px', [wideRow]: '60px', [compact]: 0 },
    paddingInlineEnd: { default: '16px', [compact]: 0 },
  },
  // Evidence can run several screens long; the verdict and the decision stay
  // beside whichever part of it is on screen.
  side: {
    position: { default: null, [wideRow]: 'sticky' },
    insetBlockStart: { default: null, [wideRow]: '16px' },
    alignSelf: { default: null, [wideRow]: 'start' },
    minWidth: 0,
  },
  sideActions: {
    display: 'flex',
    flexDirection: { default: 'row', [wideRow]: 'column-reverse' },
    flexWrap: { default: 'wrap', [wideRow]: 'nowrap' },
    gap: '8px',
    alignItems: { default: 'center', [wideRow]: 'stretch' },
    justifyContent: 'space-between',
    paddingBlockStart: { default: null, [wideRow]: '16px' },
    borderBlockStartWidth: { default: null, [wideRow]: '1px' },
    borderBlockStartStyle: { default: null, [wideRow]: 'solid' },
    borderBlockStartColor: { default: null, [wideRow]: cssVar.colorBorderSecondary },
  },
  // The verdict bar's closing line: looking harder on the left, deciding on
  // the right, at every row width.
  sideActionsInline: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    paddingBlockStart: 0,
    borderBlockStartWidth: 0,
  },
  sideActionsLeading: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '12px',
    alignItems: 'center',
    minWidth: 0,
  },
  decisionStackInline: {
    flexDirection: 'row-reverse',
  },
  detailContainer: {
    flexGrow: '1',
    flexShrink: '0',
    flexBasis: 'auto',
    containerType: 'inline-size',
  },
  detailEvidence: {
    minHeight: { default: 'min(480px, 70dvh)', [wideRow]: 'max(420px, calc(100dvh - 216px))' },
  },
  detailStack: {
    display: 'flex',
    flexDirection: { default: 'row', [wideRow]: 'column-reverse' },
    gap: '8px',
  },
  detailStackItem: {
    flex: { default: '1', [wideRow]: 'none' },
  },
  decisionStack: {
    display: 'flex',
    flexDirection: { default: 'row-reverse', [wideRow]: 'column' },
    gap: '8px',
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
