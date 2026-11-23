import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

/**
 * The column grid shared by the table's header and its rows. Below 800px of
 * container width (a phone, or a desktop page squeezed by side panels) the
 * columns fold into a three-line card: task and assignee, frequency and recent
 * runs, then the next run.
 */
export const scheduleTableStyles = stylex.create({
  assigneeCell: {
    display: 'flex',
    gridColumn: { 'default': null, '@container (max-width: 800px)': '2' },
    gridRow: { 'default': null, '@container (max-width: 800px)': '1' },
    justifyContent: 'flex-end',
  },
  cadenceCell: {
    gridColumn: { 'default': null, '@container (max-width: 800px)': '1' },
    gridRow: { 'default': null, '@container (max-width: 800px)': '2' },
    minWidth: 0,
    // Lines up with the task name, past the status glyph.
    paddingInlineStart: { 'default': null, '@container (max-width: 800px)': '24px' },
  },
  container: {
    containerType: 'inline-size',
    width: '100%',
  },
  grid: {
    alignItems: 'center',
    columnGap: '16px',
    display: 'grid',
    gridTemplateColumns: {
      'default': 'minmax(0, 1fr) 168px 216px 152px 64px',
      '@container (max-width: 800px)': 'minmax(0, 1fr) auto',
    },
    paddingInline: '12px',
    rowGap: { 'default': null, '@container (max-width: 800px)': '4px' },
  },
  // Column titles only make sense while the columns exist.
  head: {
    color: cssVar.colorTextSecondary,
    display: { 'default': 'grid', '@container (max-width: 800px)': 'none' },
    fontSize: '12px',
    paddingBlock: '6px',
  },
  runsCell: {
    display: 'flex',
    gridColumn: { 'default': null, '@container (max-width: 800px)': '2' },
    gridRow: { 'default': null, '@container (max-width: 800px)': '2' },
    justifyContent: { 'default': null, '@container (max-width: 800px)': 'flex-end' },
    minWidth: 0,
  },
  stateCell: {
    gridColumn: { 'default': null, '@container (max-width: 800px)': '1 / -1' },
    gridRow: { 'default': null, '@container (max-width: 800px)': '3' },
    minWidth: 0,
    paddingInlineStart: { 'default': null, '@container (max-width: 800px)': '24px' },
  },
  taskCell: {
    gridColumn: { 'default': null, '@container (max-width: 800px)': '1' },
    gridRow: { 'default': null, '@container (max-width: 800px)': '1' },
    minWidth: 0,
  },
});
