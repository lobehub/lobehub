import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import { sidebarRow } from '@/styles/density.stylex';
import { sx } from '@/styles/sx';

import { sectionAfterBreakMarker, sectionHeaderMarker, sectionMarker } from './markers.stylex';

export const sectionStyles = stylex.create({
  actions: {
    display: 'flex',
    flexShrink: 0,
    gap: '2px',
    alignItems: 'center',
    marginInlineStart: 'auto',
    opacity: {
      default: 0,
      [stylex.when.ancestor(':hover', sectionHeaderMarker)]: 1,
      [stylex.when.ancestor(':focus-within', sectionHeaderMarker)]: 1,
    },
    transition: 'opacity 0.12s ease',
  },
  chevron: {
    display: 'flex',
    flexShrink: 0,
    opacity: {
      default: 0,
      [stylex.when.ancestor(':hover', sectionHeaderMarker)]: 1,
      [stylex.when.ancestor(':focus-within', sectionHeaderMarker)]: 1,
    },
    transition: 'opacity 0.15s, transform 0.15s cubic-bezier(0.2, 0, 0, 1)',
  },
  chevronCollapsed: { transform: 'rotate(-90deg)', opacity: 1 },
  count: {
    flexShrink: 0,
    fontSize: sidebarRow.labelFontSize,
    fontWeight: 400,
    fontVariantNumeric: 'tabular-nums',
    color: cssVar.colorTextTertiary,
    textTransform: 'none',
    letterSpacing: 0,
  },
  pill: {
    display: 'inline-flex',
    flexShrink: 0,
    gap: '4px',
    alignItems: 'center',
    height: '20px',
    paddingInline: '6px',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: 500,
    lineHeight: '20px',
  },
  pillTone: (color: string, backgroundColor: string) => ({
    color,
    backgroundColor,
  }),
  // Emotion's `& + &` divided a section from the one directly before it. StyleX only has
  // `~`, so a section that follows a non-section sibling (a header, an empty state) passes
  // `afterBreak` and keys its spacing on a marker no section before that break carries.
  section: {
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    gap: '1px',
    marginBlockStart: {
      default: null,
      [stylex.when.siblingBefore(':is(*)', sectionMarker)]: sidebarRow.sectionGap,
    },
  },
  sectionAfterBreak: {
    marginBlockStart: {
      default: null,
      [stylex.when.siblingBefore(':is(*)', sectionAfterBreakMarker)]: sidebarRow.sectionGap,
    },
  },
  sectionHeader: {
    display: 'flex',
    flexDirection: 'row',
    flexShrink: 0,
    gap: '4px',
    alignItems: 'center',
    height: sidebarRow.sectionHeaderHeight,
    paddingInline: '6px',
  },
  sectionTitle: {
    overflow: 'hidden',
    fontSize: sidebarRow.labelFontSize,
    fontWeight: sidebarRow.labelFontWeight,
    lineHeight: sidebarRow.textLineHeight,
    color: cssVar.colorTextTertiary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  toggle: {
    cursor: 'pointer',
    display: 'flex',
    flex: '1',
    gap: '4px',
    alignItems: 'center',
    minWidth: 0,
    height: '100%',
    margin: 0,
    padding: 0,
    borderWidth: 0,
    borderStyle: 'none',
    borderColor: 'currentcolor',
    font: 'inherit',
    color: 'inherit',
    textAlign: 'start',
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    borderRadius: sidebarRow.radius,
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimaryBorder },
    outlineOffset: { 'default': null, ':focus-visible': '-2px' },
  },
});

export const sectionProps = (afterBreak = false) =>
  sx(
    sectionStyles.section,
    afterBreak && sectionStyles.sectionAfterBreak,
    afterBreak ? sectionAfterBreakMarker : sectionMarker,
  );
