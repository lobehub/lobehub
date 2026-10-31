import type { DashboardItemLayout } from '@lobechat/types';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { CSSProperties } from 'react';

import { DASHBOARD_GRID_COLUMNS, DASHBOARD_GRID_GAP, DASHBOARD_ROW_HEIGHT } from '../utils/layout';

/**
 * Cells read their placement from CSS variables (`--x`, `--y`, `--w`, `--h`) so
 * the narrow-screen fallback can drop them and stack cards in reading order.
 */
export const gridStyles = stylex.create({
  cell: {
    gridColumn: {
      'default': 'calc(var(--x) + 1) / span var(--w)',
      '@media (width <= 767px)': '1 / -1',
    },
    gridRow: {
      'default': 'calc(var(--y) + 1) / span var(--h)',
      '@media (width <= 767px)': 'auto / span var(--h)',
    },
    minHeight: 0,
    minWidth: 0,
  },
  cellDragging: {
    opacity: 0.85,
    zIndex: 2,
  },
  editCard: {
    outlineColor: cssVar.colorBorder,
    outlineOffset: '2px',
    outlineStyle: 'dashed',
    outlineWidth: '1px',
  },
  grid: {
    display: 'grid',
  },
  // The track sizes come from ../utils/layout, which StyleX cannot read at build time.
  gridTracks: (rowHeight: number, columns: number, gap: number) => ({
    gap: `${gap}px`,
    gridAutoRows: `${rowHeight}px`,
    gridTemplateColumns: {
      'default': `repeat(${columns}, minmax(0, 1fr))`,
      '@media (width <= 767px)': 'minmax(0, 1fr)',
    },
  }),
  handle: {
    color: cssVar.colorTextTertiary,
    cursor: { 'default': 'grab', ':active': 'grabbing' },
    flex: 'none',
    touchAction: 'none',
  },
});

/** The dashboard grid: pair with `cellStyle` on its cells. */
export const gridProps = () =>
  stylex.props(
    gridStyles.grid,
    gridStyles.gridTracks(DASHBOARD_ROW_HEIGHT, DASHBOARD_GRID_COLUMNS, DASHBOARD_GRID_GAP),
  );

/** Place a cell of `gridStyles.grid` at a resolved layout. */
export const cellStyle = (layout: DashboardItemLayout) =>
  ({ '--h': layout.h, '--w': layout.w, '--x': layout.x, '--y': layout.y }) as CSSProperties;
