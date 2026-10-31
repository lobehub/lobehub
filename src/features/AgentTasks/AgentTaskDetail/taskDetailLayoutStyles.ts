import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const TASK_DETAIL_SIDEBAR_MIN_WIDTH = 720;

const SIDEBAR_WIDTH = 232;

const WIDE = `@container task-detail (width >= ${TASK_DETAIL_SIDEBAR_MIN_WIDTH}px)`;

// One header, two forms, chosen by the column width rather than the viewport:
// the same sections mount in the full page, the chat-side Portal and beside
// the task-agent panel. Wide columns get a Linear-style properties sidebar;
// narrow ones fold the same triggers into a pill row under the title.
export const taskDetailLayoutStyles = stylex.create({
  root: { containerName: 'task-detail', containerType: 'inline-size' },
  header: {
    display: 'grid',
    gridTemplateColumns: {
      default: 'minmax(0, 1fr)',
      [WIDE]: `minmax(0, 1fr) ${SIDEBAR_WIDTH}px`,
    },
    rowGap: '16px',
    columnGap: { default: null, [WIDE]: '40px' },
    paddingBlockStart: '24px',
    paddingBlockEnd: '36px',
  },
  main: { minWidth: 0 },
  side: {
    minWidth: 0,
    gridColumn: { default: null, [WIDE]: 2 },
    gridRow: { default: null, [WIDE]: 1 },
    paddingBlockStart: { default: null, [WIDE]: '8px' },
  },
  properties: {
    display: 'flex',
    flexWrap: 'wrap',
    flexDirection: { default: null, [WIDE]: 'column' },
    gap: { default: '8px', [WIDE]: '2px' },
    alignItems: { default: 'center', [WIDE]: 'stretch' },
    maxWidth: '100%',
  },
  propertyItem: {
    maxWidth: '100%',
    width: { default: null, [WIDE]: '100%' },
    height: { default: '28px', [WIDE]: '30px' },
    paddingInlineStart: '8px',
    paddingInlineEnd: '10px',
    borderRadius: cssVar.borderRadius,
    whiteSpace: 'nowrap',
    backgroundColor: { default: cssVar.colorFillTertiary, [WIDE]: 'transparent' },
    backgroundImage: 'none',
  },
});
