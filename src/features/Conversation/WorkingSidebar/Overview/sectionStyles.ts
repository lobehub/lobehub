import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import { sx } from '@/styles/sx';

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
  // Sections divide themselves from the section above; `sectionProps` marks every
  // section so the next one can see it as its previous sibling.
  section: {
    flexShrink: 0,
    paddingBlock: '8px',
    paddingInline: '8px',
    borderBlockStartWidth: { default: null, [stylex.when.siblingBefore(':is(*)')]: '1px' },
    borderBlockStartStyle: { default: null, [stylex.when.siblingBefore(':is(*)')]: 'solid' },
    borderBlockStartColor: {
      default: null,
      [stylex.when.siblingBefore(':is(*)')]: cssVar.colorBorderSecondary,
    },
  },
  sectionHeader: { paddingBlockStart: 0, paddingBlockEnd: '4px', paddingInline: '8px' },
  sectionTitle: { fontSize: '10.5px', fontWeight: 600, color: cssVar.colorTextTertiary },
  skeleton: { paddingBlock: '4px', paddingInline: '8px' },
});

/** className / style for a sidebar section, with the marker the divider rule keys on. */
export const sectionProps = (className?: string) =>
  sx([sectionStyles.section, stylex.defaultMarker()], className);
