import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const catalogStyles = stylex.create({
  frame: {
    alignSelf: 'center',
    display: 'flex',
    flexDirection: 'column',
    gap: 32,
    maxWidth: 880,
    minWidth: 0,
    width: { 'default': 'calc(100% - 16px)', '@media (max-width: 860px)': '100%' },
  },
  groupFrame: { gap: 16 },
  /** A page without the catalog header starts as far down as that header does. */
  pageTop: { paddingBlockStart: 24 },
  pageTopMobile: { paddingBlockStart: 4 },
  grid: {
    columnGap: 24,
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))',
    rowGap: 4,
  },
  section: {
    borderBlockStartColor: cssVar.colorBorderSecondary,
    borderBlockStartStyle: 'solid',
    borderBlockStartWidth: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    paddingBlockStart: 16,
  },
  sections: {
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
  },
});
