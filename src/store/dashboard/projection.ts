import type { WidgetLevelFilter } from '@lobechat/types';

import { defineReplica } from '@/libs/replica';
import {
  type DashboardDetail,
  type DashboardListItem,
  dashboardService,
  type DashboardTrendSeries,
  type DashboardWidgetDetail,
  type DashboardWidgetItem,
  type DashboardWidgetRunDetail,
  type DashboardWidgetRunItem,
  type DashboardWidgetVersionItem,
} from '@/services/dashboard';
import { isTrpcErrorCode } from '@/utils/trpcError';

import { dashboardLevelKey } from './initialState';

export type {
  DashboardDetail,
  DashboardListItem,
  DashboardTrendSeries,
  DashboardWidgetDetail,
  DashboardWidgetItem,
  DashboardWidgetRunDetail,
  DashboardWidgetRunItem,
  DashboardWidgetVersionItem,
} from '@/services/dashboard';

/**
 * What a widget's trend is computed from: a stat records one point per run into
 * its primary metric; a series appends into one `series:<name>` metric per
 * series; list / table outputs have no trend.
 */
export const widgetTrendSource = (widget: DashboardWidgetItem): string | undefined => {
  const output = widget.latestOutput;
  if (output?.type === 'series') {
    const names = output.series.map((series) => series.name);
    return names.length > 0 ? `series:${names.join('\u0000')}` : undefined;
  }
  if (output?.type === 'stat' && widget.metricId) return `metric:${widget.metricId}`;
  return undefined;
};

/** The board lists a level owns directly, one entry per `dashboardLevelKey`. */
export const dashboardListResource = defineReplica<WidgetLevelFilter, DashboardListItem[]>({
  fetcher: (level) => dashboardService.list(level ?? {}),
  key: (level) => dashboardLevelKey(level),
  name: 'dashboardList',
  storage: 'indexedDB',
  version: 1,
});

/** Every board of a project (agent-owned ones included), one entry per project. */
export const projectDashboardListResource = defineReplica<string, DashboardListItem[]>({
  fetcher: (projectId) => dashboardService.listByProject(projectId),
  key: (projectId) => projectId,
  name: 'projectDashboardList',
  storage: 'indexedDB',
  version: 1,
});

/** Every widget of a project (placed or not), one entry per project. */
export const projectWidgetListResource = defineReplica<string, DashboardWidgetItem[]>({
  fetcher: (projectId) => dashboardService.listWidgetsByProject(projectId),
  key: (projectId) => projectId,
  name: 'projectWidgetList',
  storage: 'indexedDB',
  version: 1,
});

/** One board with its placed widgets, one entry per board id. */
export const dashboardDetailResource = defineReplica<string, DashboardDetail>({
  fetcher: (dashboardId) => dashboardService.detail(dashboardId),
  key: (dashboardId) => dashboardId,
  name: 'dashboardDetail',
  storage: 'indexedDB',
  version: 1,
});

/** One widget on its own — a draft an agent wrote, before any board shows it. */
export const widgetDetailResource = defineReplica<string, DashboardWidgetDetail>({
  fetcher: (widgetId) => dashboardService.widgetDetail(widgetId),
  key: (widgetId) => widgetId,
  name: 'widgetDetail',
  storage: 'indexedDB',
  version: 1,
});

/** A widget's version history, newest first (the router returns the whole list). */
export const widgetVersionsResource = defineReplica<string, DashboardWidgetVersionItem[]>({
  fetcher: (widgetId) => dashboardService.listVersions(widgetId),
  key: (widgetId) => widgetId,
  name: 'widgetVersions',
  storage: 'indexedDB',
  version: 1,
});

/**
 * A widget's recent runs, newest first. `listRuns` takes no cursor, so the
 * window is the server's (capped), not a page a client can walk — a plain list
 * replica, not a paged one.
 */
export const widgetRunsResource = defineReplica<string, DashboardWidgetRunItem[]>({
  fetcher: (widgetId) => dashboardService.listRuns(widgetId, 30),
  key: (widgetId) => widgetId,
  name: 'widgetRuns',
  storage: 'indexedDB',
  version: 1,
});

export interface WidgetRunParams {
  runId: string;
  widgetId: string;
}

/** One run with its output and logs; keyed by run id (ids are globally unique). */
export const widgetRunResource = defineReplica<WidgetRunParams, DashboardWidgetRunDetail>({
  fetcher: ({ runId, widgetId }) => dashboardService.getRun(widgetId, runId),
  key: ({ runId }) => runId,
  name: 'widgetRun',
  storage: 'memory',
  version: 1,
});

export interface WidgetPreviewRunParams {
  versionId: string;
  widgetId: string;
}

/**
 * The preview run behind a publish approval, by version: not window-limited,
 * so the card survives run-history rollover. A version with no usable preview
 * run is a normal state, not an error, so it settles to `null`.
 */
export const widgetPreviewRunResource = defineReplica<
  WidgetPreviewRunParams,
  DashboardWidgetRunDetail | null
>({
  fetcher: async ({ versionId, widgetId }) => {
    try {
      return await dashboardService.getPreviewRun(widgetId, versionId);
    } catch (error) {
      if (isTrpcErrorCode(error, 'NOT_FOUND')) return null;
      throw error;
    }
  },
  key: ({ versionId, widgetId }) => `${widgetId}:${versionId}`,
  name: 'widgetPreviewRun',
  storage: 'memory',
  version: 1,
});

/**
 * A widget's long-term trend, keyed by widget and read from the metrics the
 * runs recorded into. `source` is the query identity: a widget whose output
 * shape (or metric) changed must not hydrate the previous trend.
 */
export const widgetTrendResource = defineReplica<DashboardWidgetItem, DashboardTrendSeries[]>({
  fetcher: async (widget) => {
    const output = widget.latestOutput;
    return output?.type === 'series'
      ? dashboardService.seriesTrend(
          widget.id,
          output.series.map((series) => series.name),
        )
      : dashboardService.metricTrend(widget.metricId!);
  },
  key: (widget) => widget.id,
  name: 'widgetTrend',
  query: (widget) => widgetTrendSource(widget),
  storage: 'indexedDB',
  version: 1,
});
