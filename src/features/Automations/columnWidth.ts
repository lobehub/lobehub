/**
 * Fixed widths for every column but the subscription, which takes the rest:
 * long sources and reasons truncate inside their column instead of pushing the
 * actions out of the 1024px settings column. Below 800px the table becomes
 * cards and the widths no longer apply. Shared with the skeleton so loading
 * and loaded columns line up.
 */
export const COLUMN_WIDTH = { actions: 132, lastDelivery: 120, status: 216, target: 180 } as const;
