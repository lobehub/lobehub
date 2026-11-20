import type { DashboardItemLayout } from '@lobechat/types';
import { createStaticStyles } from '@lobehub/ui';
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
  editCell: css`
    position: relative;

    &:hover [data-resize-handle],
    & [data-resize-handle]:focus-visible,
    & [data-resize-handle][data-active='true'] {
      opacity: 1;
    }
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
  resizeHandle: css`
    touch-action: none;
    cursor: nwse-resize;

    position: absolute;
    z-index: 1;
    inset-block-end: 2px;
    inset-inline-end: 2px;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 20px;
    height: 20px;
    padding: 0;
    border: none;
    border-radius: ${cssVar.borderRadiusSM};

    color: ${cssVar.colorTextTertiary};

    opacity: 0.6;
    background: transparent;

    transition: opacity ${cssVar.motionDurationMid};

    &:hover,
    &[data-active='true'] {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
    }

    /* Stacked cards span the full width: the handle resizes height only. */
    @media (width <= 767px) {
      cursor: ns-resize;
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
