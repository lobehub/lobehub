import type { WidgetLevelFilter } from '@lobechat/types';

import type { DashboardStore } from './action';
import { dashboardLevelKey } from './initialState';

const EMPTY: never[] = [];

const dashboardList = (level?: WidgetLevelFilter) => (s: DashboardStore) =>
  s.dashboardListByLevel[dashboardLevelKey(level)] ?? EMPTY;

const projectDashboards = (projectId?: string) => (s: DashboardStore) =>
  (projectId && s.projectDashboardsMap[projectId]) || EMPTY;

const projectWidgets = (projectId?: string) => (s: DashboardStore) =>
  (projectId && s.projectWidgetsMap[projectId]) || EMPTY;

const dashboardDetail = (dashboardId?: string) => (s: DashboardStore) =>
  dashboardId ? s.dashboardDetailMap[dashboardId] : undefined;

/**
 * Whether a loaded board lives somewhere other than this project (a home board
 * or another project's), so a project route must not show it as its own.
 * False until the board has loaded.
 */
const isDashboardOutsideProject =
  (dashboardId: string, projectId: string) => (s: DashboardStore) => {
    const detail = s.dashboardDetailMap[dashboardId];
    return !!detail && detail.projectId !== projectId;
  };

/** A placed widget's hot read model, looked up across the boards already loaded. */
const widgetById = (dashboardId: string, widgetId?: string) => (s: DashboardStore) =>
  widgetId
    ? s.dashboardDetailMap[dashboardId]?.items.find(({ widget }) => widget.id === widgetId)?.widget
    : undefined;

/**
 * Only a board's creator can change it (`DashboardModel` write rule), so the
 * layout editor is offered to them alone.
 */
const canManageDashboard = (dashboardId: string, userId?: string) => (s: DashboardStore) =>
  !!userId && s.dashboardDetailMap[dashboardId]?.userId === userId;

const isWidgetRunning = (widgetId: string) => (s: DashboardStore) =>
  s.widgetRunningIds.includes(widgetId);

const isLayoutSaving = (dashboardId: string) => (s: DashboardStore) =>
  s.dashboardLayoutSavingIds.includes(dashboardId);

const widgetRuns = (widgetId?: string) => (s: DashboardStore) =>
  (widgetId && s.widgetRunsMap[widgetId]) || EMPTY;

const widgetVersions = (widgetId?: string) => (s: DashboardStore) =>
  (widgetId && s.widgetVersionsMap[widgetId]) || EMPTY;

const widgetTrend = (widgetId: string) => (s: DashboardStore) => s.widgetTrendMap[widgetId];

const widgetDetail = (widgetId?: string) => (s: DashboardStore) =>
  widgetId ? s.widgetDetailMap[widgetId] : undefined;

const widgetRunDetail = (runId?: string) => (s: DashboardStore) =>
  runId ? s.widgetRunDetailMap[runId] : undefined;

const isWidgetPublishing = (widgetId: string) => (s: DashboardStore) =>
  s.widgetPublishingIds.includes(widgetId);

const isWidgetAdding = (widgetId: string) => (s: DashboardStore) =>
  s.widgetAddingIds.includes(widgetId);

export const dashboardSelectors = {
  canManageDashboard,
  dashboardDetail,
  dashboardList,
  isDashboardOutsideProject,
  isLayoutSaving,
  isWidgetAdding,
  isWidgetPublishing,
  isWidgetRunning,
  projectDashboards,
  projectWidgets,
  widgetById,
  widgetDetail,
  widgetRunDetail,
  widgetRuns,
  widgetTrend,
  widgetVersions,
};
