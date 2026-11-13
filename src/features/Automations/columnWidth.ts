/**
 * Column widths for every column but the subscription, which takes the rest.
 * Proportional, so the subscription keeps a readable share anywhere between
 * the 800px card breakpoint and the 1024px settings column; only the actions
 * keep a fixed width, the size of their two buttons. Long content wraps or
 * truncates inside its own column instead of pushing the actions out. Shared
 * with the skeleton so loading and loaded columns line up.
 */
export const COLUMN_WIDTH = {
  actions: 132,
  lastDelivery: '12%',
  status: '26%',
  target: '18%',
} as const;
