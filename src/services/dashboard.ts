import type { DashboardItemLayout, WidgetLevelFilter } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

type DashboardRouter = typeof lambdaClient.dashboard;
type WidgetRouter = typeof lambdaClient.widget;
type QueryData<T extends { query: (...args: any[]) => Promise<any> }> = NonNullable<
  Awaited<ReturnType<T['query']>>
>['data'];

export type DashboardListItem = QueryData<DashboardRouter['list']>[number];
export type DashboardDetail = QueryData<DashboardRouter['detail']>;
/** One placed widget: the placement row plus the widget's hot read model. */
export type DashboardBoardItem = DashboardDetail['items'][number];
export type DashboardWidgetItem = DashboardBoardItem['widget'];
export type DashboardWidgetDetail = QueryData<WidgetRouter['detail']>;
export type DashboardWidgetVersionItem = QueryData<WidgetRouter['listVersions']>[number];
export type DashboardWidgetRunItem = QueryData<WidgetRouter['listRuns']>[number];
export type DashboardWidgetRunDetail = QueryData<WidgetRouter['getRun']>;

export interface DashboardLayoutPatch {
  id: string;
  layout?: DashboardItemLayout | null;
  sortOrder?: number;
}

export interface CreateDashboardParams extends WidgetLevelFilter {
  description?: string | null;
  title: string;
}

/** Trend points of one metric series, already parsed into numbers and dates. */
export interface DashboardTrendSeries {
  name: string;
  points: { observedAt: Date; value: number }[];
  unit?: string | null;
}

const TREND_POINT_LIMIT = 200;

/** Oldest first — the metric reads return recent windows in either order. */
const toPoints = (points: { observedAt: Date | string; value: number | string }[]) =>
  points
    .map((point) => ({ observedAt: new Date(point.observedAt), value: Number(point.value) }))
    .sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());

class DashboardService {
  // ── Dashboards ──

  list = async (level: WidgetLevelFilter = {}) => {
    const { data } = await lambdaClient.dashboard.list.query(level);
    return data;
  };

  /** Every board of a project, including those an agent of the project also owns. */
  listByProject = async (projectId: string) => {
    const { data } = await lambdaClient.dashboard.listByProject.query({ projectId });
    return data;
  };

  detail = async (id: string) => {
    const { data } = await lambdaClient.dashboard.detail.query({ id });
    return data;
  };

  create = async (params: CreateDashboardParams) => {
    const { data } = await lambdaClient.dashboard.create.mutate(params);
    return data;
  };

  rename = async (id: string, title: string) =>
    lambdaClient.dashboard.update.mutate({ id, value: { title } });

  trash = async (id: string) => lambdaClient.dashboard.trash.mutate({ id });

  addItem = async (dashboardId: string, widgetId: string) => {
    const { data } = await lambdaClient.dashboard.addItem.mutate({ dashboardId, widgetId });
    return data;
  };

  updateItemLayouts = async (dashboardId: string, patches: DashboardLayoutPatch[]) =>
    lambdaClient.dashboard.updateItemLayouts.mutate({ dashboardId, patches });

  removeItems = async (dashboardId: string, itemIds: string[]) =>
    lambdaClient.dashboard.removeItems.mutate({ dashboardId, itemIds });

  // ── Widgets ──

  /** Every widget of a project, including those an agent of the project also owns. */
  listWidgetsByProject = async (projectId: string) => {
    const { data } = await lambdaClient.widget.listByProject.query({ projectId });
    return data;
  };

  widgetDetail = async (widgetId: string) => {
    const { data } = await lambdaClient.widget.detail.query({ id: widgetId });
    return data;
  };

  runWidget = async (widgetId: string) => {
    const { data } = await lambdaClient.widget.run.mutate({ widgetId });
    return data;
  };

  getRun = async (widgetId: string, runId: string) => {
    const { data } = await lambdaClient.widget.getRun.query({ runId, widgetId });
    return data;
  };

  publish = async (widgetId: string, versionId: string) => {
    const { data } = await lambdaClient.widget.publish.mutate({ versionId, widgetId });
    return data;
  };

  listRuns = async (widgetId: string, limit?: number) => {
    const { data } = await lambdaClient.widget.listRuns.query({ limit, widgetId });
    return data;
  };

  listVersions = async (widgetId: string) => {
    const { data } = await lambdaClient.widget.listVersions.query({ widgetId });
    return data;
  };

  /** Run one `lobe-dashboard` agent tool call server-side (client agent runtime). */
  runAgentTool = async (
    apiName: string,
    args: unknown,
    context: { agentId?: string; messageId?: string; operationId?: string; topicId?: string },
  ) =>
    lambdaClient.dashboard.runAgentTool.mutate({
      apiName,
      args: (args ?? {}) as Record<string, unknown>,
      context,
    });

  // ── Trend (metrics / metric_points, subject `widget`) ──

  /** The primary series a stat widget records one point into per run. */
  metricTrend = async (metricId: string): Promise<DashboardTrendSeries[]> => {
    const { data } = await lambdaClient.metric.listPoints.query({
      id: metricId,
      limit: TREND_POINT_LIMIT,
    });
    return [{ name: data.title ?? '', points: toPoints(data.points), unit: data.unit }];
  };

  /** The `series:<name>` metrics a series widget appends its timestamped points to. */
  seriesTrend = async (widgetId: string, names: string[]): Promise<DashboardTrendSeries[]> => {
    if (names.length === 0) return [];

    const { data } = await lambdaClient.metric.listSeriesWithPoints.query({
      keys: names.map((name) => `series:${name}`),
      limit: TREND_POINT_LIMIT,
      subjectId: widgetId,
      subjectType: 'widget',
    });
    return data.map((series) => ({
      name: series.title ?? series.key.replace(/^series:/, ''),
      points: toPoints(series.points),
      unit: series.unit,
    }));
  };
}

export const dashboardService = new DashboardService();
