import type { DashboardItemLayout } from '@lobechat/types';
import { createStaticStyles } from 'antd-style';
import type { CSSProperties } from 'react';

import { DASHBOARD_GRID_COLUMNS, DASHBOARD_GRID_GAP, DASHBOARD_ROW_HEIGHT } from '../utils/layout';

/**
 * Cells read their placement from CSS variables (`--x`, `--y`, `--w`, `--h`) so
 * the narrow-screen fallback can drop them and stack cards in reading order.
 */
export const gridStyles = createStaticStyles(({ css, cssVar }) => ({
  cell: css`
    grid-column: calc(var(--x) + 1) / span var(--w);
    grid-row: calc(var(--y) + 1) / span var(--h);
    min-width: 0;
    min-height: 0;

    @media (width <= 767px) {
      grid-column: 1 / -1;
      grid-row: auto / span var(--h);
    }
  `,
  cellDragging: css`
    z-index: 2;
    opacity: 0.85;
  `,
  editCard: css`
    outline: 1px dashed ${cssVar.colorBorder};
    outline-offset: 2px;
  `,
  grid: css`
    display: grid;
    grid-auto-rows: ${DASHBOARD_ROW_HEIGHT}px;
    grid-template-columns: repeat(${DASHBOARD_GRID_COLUMNS}, minmax(0, 1fr));
    gap: ${DASHBOARD_GRID_GAP}px;

    @media (width <= 767px) {
      grid-template-columns: minmax(0, 1fr);
    }
  `,
  handle: css`
    touch-action: none;
    cursor: grab;
    flex: none;
    color: ${cssVar.colorTextTertiary};

    &:active {
      cursor: grabbing;
    }
  `,
}));

/** Place a cell of `gridStyles.grid` at a resolved layout. */
export const cellStyle = (layout: DashboardItemLayout) =>
  ({ '--h': layout.h, '--w': layout.w, '--x': layout.x, '--y': layout.y }) as CSSProperties;
