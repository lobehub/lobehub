import type { DashboardItemLayout, DashboardLevelFilter } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

type DashboardRouter = typeof lambdaClient.dashboard;
type QueryData<T extends { query: (...args: any[]) => Promise<any> }> = NonNullable<
  Awaited<ReturnType<T['query']>>
>['data'];

export type DashboardListItem = QueryData<DashboardRouter['list']>[number];
export type DashboardDetail = QueryData<DashboardRouter['detail']>;
/** One placed widget: the placement row plus the widget's hot read model. */
export type DashboardBoardItem = DashboardDetail['items'][number];
export type DashboardWidgetItem = DashboardBoardItem['widget'];
export type DashboardWidgetDetail = QueryData<DashboardRouter['widgetDetail']>;
export type DashboardWidgetVersionItem = QueryData<DashboardRouter['listVersions']>[number];
export type DashboardWidgetRunItem = QueryData<DashboardRouter['listRuns']>[number];

export interface DashboardLayoutPatch {
  id: string;
  layout?: DashboardItemLayout | null;
  sortOrder?: number;
}

export interface CreateDashboardParams extends DashboardLevelFilter {
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

  list = async (level: DashboardLevelFilter = {}) => {
    const { data } = await lambdaClient.dashboard.list.query(level);
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

  updateItemLayouts = async (dashboardId: string, patches: DashboardLayoutPatch[]) =>
    lambdaClient.dashboard.updateItemLayouts.mutate({ dashboardId, patches });

  removeItems = async (dashboardId: string, itemIds: string[]) =>
    lambdaClient.dashboard.removeItems.mutate({ dashboardId, itemIds });

  // ── Widgets ──

  widgetDetail = async (widgetId: string) => {
    const { data } = await lambdaClient.dashboard.widgetDetail.query({ id: widgetId });
    return data;
  };

  runWidget = async (widgetId: string) => {
    const { data } = await lambdaClient.dashboard.runWidget.mutate({ widgetId });
    return data;
  };

  listRuns = async (widgetId: string, limit?: number) => {
    const { data } = await lambdaClient.dashboard.listRuns.query({ limit, widgetId });
    return data;
  };

  listVersions = async (widgetId: string) => {
    const { data } = await lambdaClient.dashboard.listVersions.query({ widgetId });
    return data;
  };

  // ── Trend (metrics / metric_points, subject `dashboardWidget`) ──

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
      subjectType: 'dashboardWidget',
    });
    return data.map((series) => ({
      name: series.title ?? series.key.replace(/^series:/, ''),
      points: toPoints(series.points),
      unit: series.unit,
    }));
  };
}

export const dashboardService = new DashboardService();
