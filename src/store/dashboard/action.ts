import type { DashboardItemLayout, WidgetLevelFilter } from '@lobechat/types';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { dashboardKeys } from '@/libs/swr/keys';
import {
  type CreateDashboardParams,
  type DashboardDetail,
  dashboardService,
  type DashboardWidgetItem,
  type DashboardWidgetRunDetail,
} from '@/services/dashboard';
import type { StoreSetter } from '@/store/types';
import { isTrpcErrorCode } from '@/utils/trpcError';

import { dashboardLevelKey, type DashboardState } from './initialState';

/** Poll a board while one of its widgets is mid-run, so the card settles on its own. */
const RUNNING_POLL_INTERVAL = 3000;
/**
 * Slow baseline poll for boards with a scheduled run pending: a scheduled
 * widget can start after an idle load, when the cached response still says
 * nothing is running — the baseline observes the transition. SWR only fires
 * it while the tab is visible, so hidden boards cost nothing.
 */
const IDLE_POLL_INTERVAL = 30_000;
const RUN_HISTORY_LIMIT = 30;

const hasRunningWidget = (detail?: DashboardDetail) =>
  !!detail?.items.some(({ widget }) => widget.lastRunStatus === 'running');

const hasScheduledWidget = (detail?: DashboardDetail) =>
  !!detail?.items.some(({ widget }) => widget.nextRunAt != null);

const boardWidgetIds = (detail: DashboardDetail) =>
  new Set(detail.items.map(({ widget }) => widget.id));

/**
 * Whether a poll response settles a widget the cached board showed running —
 * the moment a scheduled/manual run completed and its output is live. The
 * board's own cache refreshes with the response; a widget's trend cache is
 * keyed separately and needs its own invalidation to pick the new point up.
 */
const hasRunCompleted = (previous: DashboardDetail | undefined, next: DashboardDetail) =>
  (previous?.items ?? []).some(({ widget }) => {
    if (widget.lastRunStatus !== 'running') return false;
    const current = next.items.find(({ widget: item }) => item.id === widget.id)?.widget;
    return !current || current.lastRunStatus !== 'running';
  });

/** SWR matcher over every cached board detail — a widget can sit on several boards. */
const isDashboardDetailKey = (key: unknown) =>
  Array.isArray(key) && key[0] === dashboardKeys.detail.root;

/** SWR matcher over every cached board list, whatever level or project it lists. */
const isDashboardListKey = (key: unknown) =>
  Array.isArray(key) &&
  (key[0] === dashboardKeys.list.root || key[0] === dashboardKeys.projectList.root);

/** SWR matcher over every cached project widget list — the widget may belong to any of them. */
const isProjectWidgetsKey = (key: unknown) =>
  Array.isArray(key) && key[0] === dashboardKeys.projectWidgets.root;

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

  useFetchDashboards = (level: WidgetLevelFilter = {}, enabled = true) => {
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

  /** Every board of a project, including those an agent of the project also owns. */
  useFetchProjectDashboards = (projectId?: string) =>
    useClientDataSWR(
      projectId ? dashboardKeys.projectList(projectId) : null,
      () => dashboardService.listByProject(projectId!),
      {
        onSuccess: (data) => {
          this.#set(
            (s) => ({ projectDashboardsMap: { ...s.projectDashboardsMap, [projectId!]: data } }),
            false,
            'useFetchProjectDashboards/onSuccess',
          );
        },
      },
    );

  /** Every widget of a project — placed on a board or not — so none gets lost. */
  useFetchProjectWidgets = (projectId?: string) =>
    useClientDataSWR(
      projectId ? dashboardKeys.projectWidgets(projectId) : null,
      () => dashboardService.listWidgetsByProject(projectId!),
      {
        onSuccess: (data) => {
          this.#set(
            (s) => ({ projectWidgetsMap: { ...s.projectWidgetsMap, [projectId!]: data } }),
            false,
            'useFetchProjectWidgets/onSuccess',
          );
        },
        refreshInterval: (data?: { lastRunStatus?: string | null; nextRunAt?: Date | null }[]) =>
          data?.some((widget) => widget.lastRunStatus === 'running')
            ? RUNNING_POLL_INTERVAL
            : data?.some((widget) => widget.nextRunAt != null)
              ? IDLE_POLL_INTERVAL
              : 0,
      },
    );

  useFetchDashboardDetail = (dashboardId?: string) =>
    useClientDataSWR(
      dashboardId ? dashboardKeys.detail(dashboardId) : null,
      () => dashboardService.detail(dashboardId!),
      {
        onSuccess: (data) => {
          const previous = this.#get().dashboardDetailMap[dashboardId!];
          this.internal_setDashboardDetail(data);
          if (!hasRunCompleted(previous, data)) return;
          // A run completed while this board was open: the card value and
          // status refresh with the board, but each widget's trend is cached
          // under its own key — drop just this board's widgets' trends so the
          // sparkline picks the new point up without a manual refresh.
          const ids = boardWidgetIds(data);
          void mutate(
            (key: unknown) =>
              Array.isArray(key) && key[0] === dashboardKeys.trend.root && ids.has(key[1]),
          );
        },
        refreshInterval: (data?: DashboardDetail) =>
          hasRunningWidget(data)
            ? RUNNING_POLL_INTERVAL
            : hasScheduledWidget(data)
              ? IDLE_POLL_INTERVAL
              : 0,
      },
    );

  /** A widget on its own — e.g. a draft an agent just wrote, before any board shows it. */
  useFetchWidgetDetail = (widgetId?: string) =>
    useClientDataSWR(
      widgetId ? dashboardKeys.widget(widgetId) : null,
      () => dashboardService.widgetDetail(widgetId!),
      {
        onSuccess: (data) => {
          this.#set(
            (s) => ({ widgetDetailMap: { ...s.widgetDetailMap, [data.id]: data } }),
            false,
            'useFetchWidgetDetail/onSuccess',
          );
        },
        refreshInterval: (data?: { lastRunStatus?: string | null }) =>
          data?.lastRunStatus === 'running' ? RUNNING_POLL_INTERVAL : 0,
      },
    );

  /** One run with its output and logs; polls until it settles. */
  useFetchWidgetRun = (widgetId?: string, runId?: string) =>
    useClientDataSWR(
      widgetId && runId ? dashboardKeys.run(widgetId, runId) : null,
      () => dashboardService.getRun(widgetId!, runId!),
      {
        onSuccess: (data) => {
          this.#set(
            (s) => ({ widgetRunDetailMap: { ...s.widgetRunDetailMap, [data.id]: data } }),
            false,
            'useFetchWidgetRun/onSuccess',
          );
        },
        refreshInterval: (data?: DashboardWidgetRunDetail) =>
          data?.status === 'running' ? RUNNING_POLL_INTERVAL : 0,
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

  /**
   * The preview run a publish approval was shown, fetched by version. The run
   * list only holds the newest {@link RUN_HISTORY_LIMIT} runs, so an old
   * approval's preview must be fetched directly or the card vanishes once its
   * runs roll out of the window. A version with no usable preview run answers
   * NOT_FOUND — a normal state the surfaces render as "no successful run", so
   * it maps to null instead of an error; real failures still propagate.
   */
  useFetchWidgetVersionPreviewRun = (widgetId?: string, versionId?: string) =>
    useClientDataSWR(
      widgetId && versionId ? dashboardKeys.previewRun(widgetId, versionId) : null,
      () =>
        dashboardService.getPreviewRun(widgetId!, versionId!).catch((error) => {
          if (isTrpcErrorCode(error, 'NOT_FOUND')) return null;
          throw error;
        }),
      {
        onSuccess: (data) => {
          if (!data) return;
          this.#set(
            (s) => ({ widgetRunDetailMap: { ...s.widgetRunDetailMap, [data.id]: data } }),
            false,
            'useFetchWidgetVersionPreviewRun/onSuccess',
          );
        },
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
      await Promise.all([
        this.refreshDashboards(params),
        params.widgetId ? this.refreshWidgetDetail(params.widgetId) : undefined,
      ]);
      return dashboard;
    } finally {
      this.#set({ dashboardCreating: false }, false, 'createDashboard/end');
    }
  };

  renameDashboard = async (dashboardId: string, title: string, level?: WidgetLevelFilter) => {
    await dashboardService.rename(dashboardId, title);
    await Promise.all([this.refreshDashboardDetail(dashboardId), this.refreshDashboards(level)]);
  };

  trashDashboard = async (dashboardId: string, level?: WidgetLevelFilter) => {
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

  /**
   * Make a dry-run-proven version live, then run it once so every board shows
   * live data right away. The server refuses a version whose exact content has
   * not succeeded in a dry run; a failing first run leaves the publish in place.
   */
  publishWidgetVersion = async (widgetId: string, versionId: string) => {
    this.#set(
      (s) => ({ widgetPublishingIds: [...s.widgetPublishingIds, widgetId] }),
      false,
      'publishWidgetVersion/start',
    );
    try {
      const result = await dashboardService.publish(widgetId, versionId);
      await mutate(dashboardKeys.versions(widgetId));
      await this.runWidget(widgetId).catch((error) => {
        console.error('[dashboard] first run after publish failed', error);
      });
      return result;
    } finally {
      this.#set(
        (s) => ({ widgetPublishingIds: s.widgetPublishingIds.filter((id) => id !== widgetId) }),
        false,
        'publishWidgetVersion/end',
      );
    }
  };

  addWidgetToDashboard = async (dashboardId: string, widgetId: string) => {
    this.#set(
      (s) => ({ widgetAddingIds: [...s.widgetAddingIds, widgetId] }),
      false,
      'addWidgetToDashboard/start',
    );
    try {
      const item = await dashboardService.addItem(dashboardId, widgetId);
      await Promise.all([
        this.refreshDashboardDetail(dashboardId),
        this.refreshWidgetDetail(widgetId),
      ]);
      return item;
    } finally {
      this.#set(
        (s) => ({ widgetAddingIds: s.widgetAddingIds.filter((id) => id !== widgetId) }),
        false,
        'addWidgetToDashboard/end',
      );
    }
  };

  // ── Refresh ──

  refreshWidgetDetail = async (widgetId: string) => {
    await mutate(dashboardKeys.widget(widgetId));
  };

  /** The level's own list, plus the project-wide list when the level sits in a project. */
  refreshDashboards = async (level?: WidgetLevelFilter) => {
    await Promise.all([
      mutate(dashboardKeys.list(dashboardLevelKey(level))),
      level?.projectId && mutate(dashboardKeys.projectList(level.projectId)),
    ]);
  };

  refreshDashboardDetail = async (dashboardId: string) => {
    await mutate(dashboardKeys.detail(dashboardId));
  };

  /**
   * The agent placed a widget on a board server-side (possibly a board it just
   * created): revalidate the widget's board membership, that board (every
   * cached board when unknown), and every cached board list so open views pick
   * it up without a reload.
   */
  refreshWidgetPlacement = async (widgetId: string, dashboardId?: string) => {
    await Promise.all([
      mutate(dashboardKeys.widget(widgetId)),
      mutate(dashboardId ? dashboardKeys.detail(dashboardId) : isDashboardDetailKey),
      mutate(isDashboardListKey),
      mutate(isProjectWidgetsKey),
    ]);
  };

  refreshWidget = async (widgetId: string) => {
    await Promise.all([
      mutate(isDashboardDetailKey),
      mutate(isProjectWidgetsKey),
      mutate(dashboardKeys.widget(widgetId)),
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
