import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

const orbit = stylex.keyframes({
  to: { transform: 'rotate(360deg)' },
});

const completePop = stylex.keyframes({
  '0%': { opacity: 0, transform: 'scale(0.5)' },
  '55%': { transform: 'scale(1)' },
  '100%': { opacity: 1, transform: 'scale(1)' },
});

const reducedMotion = '@media (prefers-reduced-motion: reduce)';
const phone = '@media (width <= 767px)';
const narrow = '@media (width <= 480px)';

export const decisionBarStyles = stylex.create({
  repairingArc: {
    transformOrigin: 'center',
    animationName: { default: orbit, [reducedMotion]: 'none' },
    animationDuration: { default: '1.2s', [reducedMotion]: '0s' },
    animationTimingFunction: { default: 'linear', [reducedMotion]: 'ease' },
    animationIterationCount: { default: 'infinite', [reducedMotion]: 1 },
  },
  // Docked to the column's bottom edge rather than floating over it: the
  // negative block-end margin cancels the column's own bottom padding so the
  // bar does not lift when the list scrolls to its end.
  bar: {
    position: 'sticky',
    zIndex: 20,
    insetBlockEnd: 0,
    flex: 'none',
    width: '100%',
    marginBlockEnd: '-20px',
    paddingBlockStart: '16px',
    paddingBlockEnd: { default: '16px', [phone]: 'max(16px, env(safe-area-inset-bottom))' },
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
    backgroundColor: cssVar.colorBgContainer,
  },
  // Spans the scroll frame edge to edge, so its rule mirrors the header
  // band's under the tabs. It sits after the padded column, not inside it,
  // so there is no column padding to cancel.
  barDocked: {
    marginBlockEnd: 0,
  },
  content: {
    display: 'flex',
    flexWrap: 'wrap',
    columnGap: '16px',
    rowGap: '12px',
    alignItems: 'center',
    paddingInline: { default: '16px', [phone]: 0 },
  },
  // The column's own inline padding (24 / 16) plus the bar's (16 / 0), so the
  // content lands where it did inside the column.
  contentDocked: {
    width: '100%',
    marginInline: 'auto',
    paddingInline: { default: '40px', [phone]: '16px' },
  },
  strip: {
    position: 'absolute',
    insetInline: 0,
    insetBlockStart: '-2px',
    gap: 0,
    height: '2px',
  },
  // The bar's rule is the strip's track: an undecided check leaves it bare,
  // so an unreviewed list reads as the same 1px rule as the one under the tabs
  // instead of a heavier gray band.
  stripPending: {
    backgroundColor: 'transparent',
  },
  stripSegment: {
    borderRadius: 0,
  },
  // On a phone the strip above already carries the split; three more lines
  // of counts would push the two buttons off the first screen.
  tallyRow: {
    display: { default: 'flex', [phone]: 'none' },
    flexWrap: 'wrap',
    columnGap: '12px',
  },
  tally: {
    display: 'inline-flex',
    gap: '6px',
    alignItems: 'center',
    fontSize: '12px',
    lineHeight: '20px',
    color: cssVar.colorTextSecondary,
  },
  dot: {
    width: '8px',
    height: '8px',
    borderRadius: '2px',
    backgroundColor: cssVar.colorFillSecondary,
  },
  dotAccepted: { backgroundColor: cssVar.colorSuccess },
  dotNeedsFix: { backgroundColor: cssVar.colorError },
  dotIgnored: { backgroundColor: cssVar.colorTextQuaternary },
  mark: {
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    height: '22px',
  },
  statusText: {
    fontSize: '14px',
    fontWeight: 500,
    lineHeight: '22px',
    color: cssVar.colorText,
  },
  summary: {
    flex: '1',
    minWidth: '160px',
  },
  actions: {
    flex: 'none',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    width: { default: null, [narrow]: '100%' },
  },
  actionButton: {
    flex: { default: 'none', [narrow]: '1' },
  },
  completePop: {
    animationName: { default: completePop, [reducedMotion]: 'none' },
    animationDuration: { default: '0.2s', [reducedMotion]: '0s' },
    animationTimingFunction: { default: 'ease-out', [reducedMotion]: 'ease' },
    animationFillMode: { default: 'both', [reducedMotion]: 'none' },
  },
});
