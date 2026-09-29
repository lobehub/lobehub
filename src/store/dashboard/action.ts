import type { DashboardItemLayout, DashboardLevelFilter } from '@lobechat/types';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { dashboardKeys } from '@/libs/swr/keys';
import {
  type CreateDashboardParams,
  type DashboardDetail,
  dashboardService,
  type DashboardWidgetItem,
} from '@/services/dashboard';
import type { StoreSetter } from '@/store/types';

import { dashboardLevelKey, type DashboardState } from './initialState';

/** Poll a board while one of its widgets is mid-run, so the card settles on its own. */
const RUNNING_POLL_INTERVAL = 3000;
const RUN_HISTORY_LIMIT = 30;

const hasRunningWidget = (detail?: DashboardDetail) =>
  !!detail?.items.some(({ widget }) => widget.lastRunStatus === 'running');

/** SWR matcher over every cached board detail — a widget can sit on several boards. */
const isDashboardDetailKey = (key: unknown) =>
  Array.isArray(key) && key[0] === dashboardKeys.detail.root;

/**
 * Where a widget's trend comes from: a stat records one point per run into its
 * primary metric; a series appends into one `series:<name>` metric per series.
 * list / table outputs have no trend.
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

export type DashboardStore = DashboardState & DashboardAction;
type Setter = StoreSetter<DashboardStore>;

export class DashboardActionImpl {
  readonly #get: () => DashboardStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => DashboardStore, _api?: unknown) {
    void _api;
    this.#get = get;
    this.#set = set;
  }

  // ── Reads ──

  useFetchDashboards = (level: DashboardLevelFilter = {}, enabled = true) => {
    const levelKey = dashboardLevelKey(level);
    return useClientDataSWR(
      enabled ? dashboardKeys.list(levelKey) : null,
      () => dashboardService.list(level),
      {
        onSuccess: (data) => {
          this.#set(
            (s) => ({ dashboardListByLevel: { ...s.dashboardListByLevel, [levelKey]: data } }),
            false,
            'useFetchDashboards/onSuccess',
          );
        },
      },
    );
  };

  useFetchDashboardDetail = (dashboardId?: string) =>
    useClientDataSWR(
      dashboardId ? dashboardKeys.detail(dashboardId) : null,
      () => dashboardService.detail(dashboardId!),
      {
        onSuccess: (data) => {
          this.internal_setDashboardDetail(data);
        },
        refreshInterval: (data?: DashboardDetail) =>
          hasRunningWidget(data) ? RUNNING_POLL_INTERVAL : 0,
      },
    );

  useFetchWidgetRuns = (widgetId?: string) =>
    useClientDataSWR(
      widgetId ? dashboardKeys.runs(widgetId) : null,
      () => dashboardService.listRuns(widgetId!, RUN_HISTORY_LIMIT),
      {
        onSuccess: (data) => {
          this.#set(
            (s) => ({ widgetRunsMap: { ...s.widgetRunsMap, [widgetId!]: data } }),
            false,
            'useFetchWidgetRuns/onSuccess',
          );
        },
        refreshInterval: (data?: { status: string }[]) =>
          data?.some((run) => run.status === 'running') ? RUNNING_POLL_INTERVAL : 0,
      },
    );

  useFetchWidgetVersions = (widgetId?: string) =>
    useClientDataSWR(
      widgetId ? dashboardKeys.versions(widgetId) : null,
      () => dashboardService.listVersions(widgetId!),
      {
        onSuccess: (data) => {
          this.#set(
            (s) => ({ widgetVersionsMap: { ...s.widgetVersionsMap, [widgetId!]: data } }),
            false,
            'useFetchWidgetVersions/onSuccess',
          );
        },
      },
    );

  useFetchWidgetTrend = (widget?: DashboardWidgetItem) => {
    const source = widget ? widgetTrendSource(widget) : undefined;
    return useClientDataSWR(
      widget && source ? dashboardKeys.trend(widget.id, source) : null,
      () => {
        const output = widget!.latestOutput;
        return output?.type === 'series'
          ? dashboardService.seriesTrend(
              widget!.id,
              output.series.map((series) => series.name),
            )
          : dashboardService.metricTrend(widget!.metricId!);
      },
      {
        onSuccess: (data) => {
          this.#set(
            (s) => ({ widgetTrendMap: { ...s.widgetTrendMap, [widget!.id]: data } }),
            false,
            'useFetchWidgetTrend/onSuccess',
          );
        },
      },
    );
  };

  // ── Dashboards ──

  createDashboard = async (params: CreateDashboardParams) => {
    this.#set({ dashboardCreating: true }, false, 'createDashboard/start');
    try {
      const dashboard = await dashboardService.create(params);
      await this.refreshDashboards(params);
      return dashboard;
    } finally {
      this.#set({ dashboardCreating: false }, false, 'createDashboard/end');
    }
  };

  renameDashboard = async (dashboardId: string, title: string, level?: DashboardLevelFilter) => {
    await dashboardService.rename(dashboardId, title);
    await Promise.all([this.refreshDashboardDetail(dashboardId), this.refreshDashboards(level)]);
  };

  trashDashboard = async (dashboardId: string, level?: DashboardLevelFilter) => {
    await dashboardService.trash(dashboardId);
    await this.refreshDashboards(level);
  };

  /**
   * Persist a board's layout. The new cells render right away; a rejected save
   * revalidates the board so the grid snaps back to what the server holds.
   */
  saveDashboardLayout = async (
    dashboardId: string,
    layouts: Record<string, DashboardItemLayout>,
    order: string[],
  ) => {
    const detail = this.#get().dashboardDetailMap[dashboardId];
    const sortOrderOf = new Map(order.map((id, index) => [id, index]));
    const patches = Object.entries(layouts).map(([id, layout]) => ({
      id,
      layout,
      sortOrder: sortOrderOf.get(id),
    }));

    if (detail) {
      this.internal_setDashboardDetail({
        ...detail,
        items: detail.items
          .map((entry) => ({
            ...entry,
            item: {
              ...entry.item,
              layout: layouts[entry.item.id] ?? entry.item.layout,
              sortOrder: sortOrderOf.get(entry.item.id) ?? entry.item.sortOrder,
            },
          }))
          .sort((a, b) => a.item.sortOrder - b.item.sortOrder),
      });
    }

    this.#set(
      (s) => ({ dashboardLayoutSavingIds: [...s.dashboardLayoutSavingIds, dashboardId] }),
      false,
      'saveDashboardLayout/start',
    );
    try {
      await dashboardService.updateItemLayouts(dashboardId, patches);
    } catch (error) {
      await this.refreshDashboardDetail(dashboardId);
      throw error;
    } finally {
      this.#set(
        (s) => ({
          dashboardLayoutSavingIds: s.dashboardLayoutSavingIds.filter((id) => id !== dashboardId),
        }),
        false,
        'saveDashboardLayout/end',
      );
    }
  };

  removeWidgetFromDashboard = async (dashboardId: string, itemId: string) => {
    await dashboardService.removeItems(dashboardId, [itemId]);
    await this.refreshDashboardDetail(dashboardId);
  };

  // ── Widgets ──

  /**
   * Refresh a widget now. The run executes synchronously on the server; every
   * board showing the widget, its history and its trend revalidate afterwards,
   * whether the run succeeded or not.
   */
  runWidget = async (widgetId: string) => {
    this.#set(
      (s) => ({ widgetRunningIds: [...s.widgetRunningIds, widgetId] }),
      false,
      'runWidget/start',
    );
    try {
      return await dashboardService.runWidget(widgetId);
    } finally {
      this.#set(
        (s) => ({ widgetRunningIds: s.widgetRunningIds.filter((id) => id !== widgetId) }),
        false,
        'runWidget/end',
      );
      await this.refreshWidget(widgetId);
    }
  };

  // ── Refresh ──

  refreshDashboards = async (level?: DashboardLevelFilter) => {
    await mutate(dashboardKeys.list(dashboardLevelKey(level)));
  };

  refreshDashboardDetail = async (dashboardId: string) => {
    await mutate(dashboardKeys.detail(dashboardId));
  };

  refreshWidget = async (widgetId: string) => {
    await Promise.all([
      mutate(isDashboardDetailKey),
      mutate(dashboardKeys.runs(widgetId)),
      mutate(
        (key: unknown) =>
          Array.isArray(key) && key[0] === dashboardKeys.trend.root && key[1] === widgetId,
      ),
    ]);
  };

  // ── Internal ──

  internal_setDashboardDetail = (detail: DashboardDetail) => {
    this.#set(
      (s) => ({ dashboardDetailMap: { ...s.dashboardDetailMap, [detail.id]: detail } }),
      false,
      'internal_setDashboardDetail',
    );
  };
}

export type DashboardAction = Pick<DashboardActionImpl, keyof DashboardActionImpl>;
