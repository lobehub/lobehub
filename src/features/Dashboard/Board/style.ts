import type { DashboardItemLayout } from '@lobechat/types';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { CSSProperties } from 'react';

import { DASHBOARD_GRID_COLUMNS, DASHBOARD_GRID_GAP, DASHBOARD_ROW_HEIGHT } from '../utils/layout';

const ACTIVE = "[data-active='true']";

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
  editCell: {
    position: 'relative',
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
  resizeHandle: {
    alignItems: 'center',
    backgroundColor: {
      'default': 'transparent',
      ':hover': cssVar.colorFillSecondary,
      [ACTIVE]: cssVar.colorFillSecondary,
    },
    backgroundImage: 'none',
    borderColor: 'currentcolor',
    borderRadius: cssVar.borderRadiusSM,
    borderStyle: 'none',
    borderWidth: 0,
    color: {
      'default': cssVar.colorTextTertiary,
      ':hover': cssVar.colorText,
      [ACTIVE]: cssVar.colorText,
    },
    cursor: { 'default': 'nwse-resize', '@media (width <= 767px)': 'ns-resize' },
    display: 'flex',
    height: '20px',
    insetBlockEnd: '2px',
    insetInlineEnd: '2px',
    justifyContent: 'center',
    opacity: {
      'default': 0.6,
      ':focus-visible': 1,
      [stylex.when.ancestor(':hover')]: 1,
      [ACTIVE]: 1,
    },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimary },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    paddingBlock: 0,
    paddingInline: 0,
    position: 'absolute',
    touchAction: 'none',
    transition: `opacity ${cssVar.motionDurationMid}`,
    width: '20px',
    zIndex: 1,
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
