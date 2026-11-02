import type { DashboardItemLayout, WidgetOutputType } from '@lobechat/types';

/** Board grid width in columns; `dashboard_items.layout` is expressed in these units. */
export const DASHBOARD_GRID_COLUMNS = 12;
/** Height of one grid row in pixels. */
export const DASHBOARD_ROW_HEIGHT = 72;
export const DASHBOARD_GRID_GAP = 16;

export const DASHBOARD_MIN_H = 2;
export const DASHBOARD_MAX_H = 12;

/** Width presets offered while editing, in columns. */
export const DASHBOARD_WIDTH_PRESETS = [3, 4, 6, 8, 12] as const;

const DEFAULT_SIZE: Record<WidgetOutputType, { h: number; w: number }> = {
  list: { h: 4, w: 6 },
  series: { h: 4, w: 6 },
  // Three rows (240px): header, label, value, description, the 28px trend line
  // and the updated-at footer. Two rows squeezed the trend line to nothing.
  stat: { h: 3, w: 3 },
  // A layout card (weather, progress, …) reads best close to square.
  data: { h: 4, w: 4 },
  table: { h: 4, w: 12 },
};

export const defaultWidgetSize = (outputType?: WidgetOutputType | null) =>
  DEFAULT_SIZE[outputType ?? 'stat'] ?? DEFAULT_SIZE.stat;

export interface LayoutEntry {
  id: string;
  layout?: DashboardItemLayout | null;
  outputType?: WidgetOutputType | null;
}

const clampSize = ({ h, w }: { h: number; w: number }) => ({
  h: Math.min(DASHBOARD_MAX_H, Math.max(DASHBOARD_MIN_H, Math.round(h))),
  w: Math.min(DASHBOARD_GRID_COLUMNS, Math.max(1, Math.round(w))),
});

const overlaps = (a: DashboardItemLayout, b: DashboardItemLayout) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Resolve every item to a concrete grid cell.
 *
 * Items keep a persisted layout when it fits the grid and does not collide with
 * one placed before it; the rest (new placements, agent-created items with no
 * layout) drop into the first free slot scanning top-down, left-right.
 */
export const resolveLayouts = (entries: LayoutEntry[]): Record<string, DashboardItemLayout> => {
  const placed: DashboardItemLayout[] = [];
  const result: Record<string, DashboardItemLayout> = {};
  const pending: LayoutEntry[] = [];

  for (const entry of entries) {
    const layout = entry.layout;
    if (layout) {
      const size = clampSize(layout);
      const candidate = {
        ...size,
        x: Math.max(0, Math.round(layout.x)),
        y: Math.max(0, Math.round(layout.y)),
      };
      if (
        candidate.x + candidate.w <= DASHBOARD_GRID_COLUMNS &&
        !placed.some((other) => overlaps(other, candidate))
      ) {
        placed.push(candidate);
        result[entry.id] = candidate;
        continue;
      }
    }
    pending.push(entry);
  }

  for (const entry of pending) {
    const size = clampSize(entry.layout ?? defaultWidgetSize(entry.outputType));
    for (let y = 0; ; y++) {
      let found: DashboardItemLayout | undefined;
      for (let x = 0; x + size.w <= DASHBOARD_GRID_COLUMNS; x++) {
        const candidate = { ...size, x, y };
        if (!placed.some((other) => overlaps(other, candidate))) {
          found = candidate;
          break;
        }
      }
      if (found) {
        placed.push(found);
        result[entry.id] = found;
        break;
      }
    }
  }

  return result;
};

/**
 * Flow items in the given order into rows, like text: each item goes right of
 * the previous one and wraps when the row is full. Used after a drag reorder or
 * a resize, where the order is the user's intent and positions follow from it.
 */
export const flowLayouts = (
  entries: { h: number; id: string; w: number }[],
): Record<string, DashboardItemLayout> => {
  const result: Record<string, DashboardItemLayout> = {};
  let x = 0;
  let y = 0;
  let rowHeight = 0;

  for (const entry of entries) {
    const { h, w } = clampSize(entry);
    if (x + w > DASHBOARD_GRID_COLUMNS) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    result[entry.id] = { h, w, x, y };
    x += w;
    rowHeight = Math.max(rowHeight, h);
  }

  return result;
};

/** Reading order of resolved layouts: top to bottom, then left to right. */
export const sortByPosition = <T extends { id: string }>(
  items: T[],
  layouts: Record<string, DashboardItemLayout>,
) =>
  [...items].sort((a, b) => {
    const la = layouts[a.id];
    const lb = layouts[b.id];
    if (!la || !lb) return 0;
    return la.y - lb.y || la.x - lb.x;
  });

export const isSameLayout = (a?: DashboardItemLayout | null, b?: DashboardItemLayout | null) =>
  !!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/** Narrowest a card may be resized to, in columns. */
export const DASHBOARD_MIN_W = DASHBOARD_WIDTH_PRESETS[0];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * The media query under which the board stacks its cards in one column.
 * Keep in sync with the `@media` rules in `Board/style.ts`.
 */
export const DASHBOARD_STACKED_QUERY = '(width <= 767px)';

interface ResizeOptions {
  /**
   * The board is stacked (narrow screen): every card spans the full width,
   * so only height can change; the saved width — what wider screens use —
   * is kept as it is.
   */
  stacked?: boolean;
}

/**
 * The size a card snaps to while its resize handle is dragged by `dx` / `dy`
 * pixels on a grid `gridWidth` pixels wide: the dragged pixel size rounded to
 * whole columns and rows (gaps included), within the board's limits.
 */
export const resizeByPointer = (
  start: { h: number; w: number },
  delta: { dx: number; dy: number },
  gridWidth: number,
  { stacked = false }: ResizeOptions = {},
): { h: number; w: number } => {
  const h = clamp(
    Math.round(
      (start.h * DASHBOARD_ROW_HEIGHT +
        (start.h - 1) * DASHBOARD_GRID_GAP +
        delta.dy +
        DASHBOARD_GRID_GAP) /
        (DASHBOARD_ROW_HEIGHT + DASHBOARD_GRID_GAP),
    ),
    DASHBOARD_MIN_H,
    DASHBOARD_MAX_H,
  );
  if (stacked) return { h, w: start.w };

  const columnWidth =
    (gridWidth - DASHBOARD_GRID_GAP * (DASHBOARD_GRID_COLUMNS - 1)) / DASHBOARD_GRID_COLUMNS;
  if (!(columnWidth > 0)) return start;

  const startWidth = start.w * columnWidth + (start.w - 1) * DASHBOARD_GRID_GAP;
  const w = Math.round(
    (startWidth + delta.dx + DASHBOARD_GRID_GAP) / (columnWidth + DASHBOARD_GRID_GAP),
  );

  return { h, w: clamp(w, DASHBOARD_MIN_W, DASHBOARD_GRID_COLUMNS) };
};

/**
 * One keyboard step of the resize handle: arrows grow or shrink by a column
 * or a row. On a stacked board only up / down apply.
 */
export const resizeByKey = (
  size: { h: number; w: number },
  key: string,
  { stacked = false }: ResizeOptions = {},
): { h: number; w: number } | undefined => {
  const step: Record<string, { dh: number; dw: number }> = {
    ArrowDown: { dh: 1, dw: 0 },
    ArrowLeft: { dh: 0, dw: -1 },
    ArrowRight: { dh: 0, dw: 1 },
    ArrowUp: { dh: -1, dw: 0 },
  };
  const move = step[key];
  if (!move || (stacked && move.dw !== 0)) return undefined;
  return {
    h: clamp(size.h + move.dh, DASHBOARD_MIN_H, DASHBOARD_MAX_H),
    w: clamp(size.w + move.dw, DASHBOARD_MIN_W, DASHBOARD_GRID_COLUMNS),
  };
};
