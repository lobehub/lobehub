import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { media } from '@lobehub/ui/stylex/media.stylex';
import * as stylex from '@stylexjs/stylex';

/**
 * Page chrome shared by the dashboard pages (board list, one board, a
 * project's dashboards): a wide canvas — a board is read at a glance, so it
 * gets the width the chat column does not need — and one heading scale.
 */
export const dashboardPageStyles = stylex.create({
  canvas: {
    display: 'flex',
    flexDirection: 'column',
    gap: { default: '24px', [media.sm]: '16px' },
    marginInline: 'auto',
    maxWidth: '1440px',
    paddingBlockEnd: { default: '48px', [media.sm]: '32px' },
    paddingBlockStart: { default: '24px', [media.sm]: '16px' },
    paddingInline: { default: '32px', [media.sm]: '16px' },
    width: '100%',
  },
  description: {
    color: cssVar.colorTextSecondary,
    maxWidth: '72ch',
  },
  heading: {
    alignItems: { default: null, [media.sm]: 'stretch' },
    flexDirection: { default: null, [media.sm]: 'column' },
  },
  scroll: {
    flex: '1',
    minHeight: 0,
    overflowY: 'auto',
  },
  sectionTitle: {
    color: cssVar.colorText,
    fontSize: '15px',
    fontWeight: 600,
    lineHeight: 1.4,
    margin: 0,
  },
  title: {
    color: cssVar.colorText,
    fontSize: '22px',
    fontWeight: 600,
    letterSpacing: '-0.01em',
    lineHeight: 1.3,
    margin: 0,
  },
});
