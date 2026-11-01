// ============================================
// Dashboard — boards that lay out widgets
// (`dashboards` / `dashboard_items` tables)
// ============================================
//
// A dashboard is a named, laid-out collection of widgets at one ownership
// level. Widgets live on their own (see `../widget`); a board only references
// them through `dashboard_items`, so one widget can sit on several boards.

export const DASHBOARD_VISIBILITIES = ['private', 'public'] as const;
export type DashboardVisibility = (typeof DASHBOARD_VISIBILITIES)[number];

/** Grid placement of one item on a dashboard, in grid units. */
export interface DashboardItemLayout {
  h: number;
  w: number;
  x: number;
  y: number;
}
