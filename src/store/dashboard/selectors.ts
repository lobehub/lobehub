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

/** A placed widget's hot read model, looked up across the boards already loaded. */
const widgetById = (dashboardId: string, widgetId?: string) => (s: DashboardStore) =>
  widgetId
    ? s.dashboardDetailMap[dashboardId]?.items.find(({ widget }) => widget.id === widgetId)?.widget
    : undefined;

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
  dashboardDetail,
  dashboardList,
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
