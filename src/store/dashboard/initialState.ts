import type { DashboardLevelFilter } from '@lobechat/types';

import type {
  DashboardDetail,
  DashboardListItem,
  DashboardTrendSeries,
  DashboardWidgetRunItem,
  DashboardWidgetVersionItem,
} from '@/services/dashboard';

export interface DashboardState {
  /** A create request is in flight (no persistent id to key it by yet). */
  dashboardCreating: boolean;
  /** Boards with their placed widgets, keyed by dashboard id. */
  dashboardDetailMap: Record<string, DashboardDetail>;
  /** Boards whose layout save is in flight. */
  dashboardLayoutSavingIds: string[];
  /** Board lists keyed by `dashboardLevelKey` — each level lists only what lives directly on it. */
  dashboardListByLevel: Record<string, DashboardListItem[]>;
  /** Widgets with a manual refresh in flight from this client. */
  widgetRunningIds: string[];
  /** Recent run history, newest first, keyed by widget id. */
  widgetRunsMap: Record<string, DashboardWidgetRunItem[]>;
  /** Long-term metric trend, keyed by widget id. */
  widgetTrendMap: Record<string, DashboardTrendSeries[]>;
  /** Version history, newest first, keyed by widget id. */
  widgetVersionsMap: Record<string, DashboardWidgetVersionItem[]>;
}

export const initialState: DashboardState = {
  dashboardCreating: false,
  dashboardDetailMap: {},
  dashboardLayoutSavingIds: [],
  dashboardListByLevel: {},
  widgetRunningIds: [],
  widgetRunsMap: {},
  widgetTrendMap: {},
  widgetVersionsMap: {},
};

/** Personal (or current-workspace) level when neither id is set. */
export const dashboardLevelKey = ({ agentId, projectId }: DashboardLevelFilter = {}) =>
  [projectId && `project:${projectId}`, agentId && `agent:${agentId}`].filter(Boolean).join('/') ||
  'personal';
