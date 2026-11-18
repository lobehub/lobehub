import * as stylex from '@stylexjs/stylex';

/**
 * The page's centred reading column. Shared so content rendered outside the
 * body column (the docked decision bar's fallbacks) lands on the same edges.
 * Callers add the tab's `maxWidth` inline.
 */
export const columnStyles = stylex.create({
  column: {
    width: '100%',
    marginInline: 'auto',
    paddingInline: { 'default': '24px', '@media (width <= 767px)': '16px' },
  },
});
