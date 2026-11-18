import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import { sx } from '@/styles/sx';

import { sectionAfterBreakMarker, sectionMarker } from './markers.stylex';

export const sectionStyles = stylex.create({
  count: {
    paddingBlock: '1px',
    paddingInline: '6px',
    borderRadius: '4px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '11px',
    fontWeight: 500,
    color: cssVar.colorTextSecondary,
    textTransform: 'none',
    letterSpacing: 0,
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
  pill: {
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'center',
    height: '20px',
    paddingInline: '7px',
    borderRadius: '6px',
    fontSize: '11.5px',
    fontWeight: 500,
    lineHeight: '20px',
  },
  // Emotion's `& + &` divided a section from the one directly before it. StyleX only has
  // `~`, so a section that follows a non-section sibling (a header, an empty state) passes
  // `afterBreak` and keys its divider on a marker no section before that break carries.
  section: {
    flexShrink: 0,
    paddingBlock: '8px',
    paddingInline: '8px',
    borderBlockStartWidth: {
      default: null,
      [stylex.when.siblingBefore(':is(*)', sectionMarker)]: '1px',
    },
    borderBlockStartStyle: {
      default: null,
      [stylex.when.siblingBefore(':is(*)', sectionMarker)]: 'solid',
    },
    borderBlockStartColor: {
      default: null,
      [stylex.when.siblingBefore(':is(*)', sectionMarker)]: cssVar.colorBorderSecondary,
    },
  },
  sectionAfterBreak: {
    borderBlockStartWidth: {
      default: null,
      [stylex.when.siblingBefore(':is(*)', sectionAfterBreakMarker)]: '1px',
    },
    borderBlockStartStyle: {
      default: null,
      [stylex.when.siblingBefore(':is(*)', sectionAfterBreakMarker)]: 'solid',
    },
    borderBlockStartColor: {
      default: null,
      [stylex.when.siblingBefore(':is(*)', sectionAfterBreakMarker)]: cssVar.colorBorderSecondary,
    },
  },
  sectionHeader: { paddingBlockStart: 0, paddingBlockEnd: '4px', paddingInline: '8px' },
  sectionTitle: { fontSize: '10.5px', fontWeight: 600, color: cssVar.colorTextTertiary },
  skeleton: { paddingBlock: '4px', paddingInline: '8px' },
});

export const sectionProps = (afterBreak = false) =>
  sx(
    sectionStyles.section,
    afterBreak && sectionStyles.sectionAfterBreak,
    afterBreak ? sectionAfterBreakMarker : sectionMarker,
  );
