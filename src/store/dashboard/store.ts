'use client';

import type { DashboardItemLayout, WidgetLevelFilter } from '@lobechat/types';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import {
  arrayEntity,
  createReplicaSlice,
  linkReplicaEntity,
  recordLens,
  type ReplicaSyncResult,
  singleEntity,
} from '@/libs/replica';
import {
  type CreateDashboardParams,
  type DashboardLayoutPatch,
  dashboardService,
} from '@/services/dashboard';
import { createDevtools } from '@/store/middleware/createDevtools';
import { expose } from '@/store/middleware/expose';

import { dashboardLevelKey, type DashboardState, initialState } from './initialState';
import {
  type DashboardDetail,
  dashboardDetailResource,
  type DashboardListItem,
  dashboardListResource,
  type DashboardTrendSeries,
  type DashboardWidgetDetail,
  type DashboardWidgetItem,
  type DashboardWidgetRunDetail,
  type DashboardWidgetRunItem,
  type DashboardWidgetVersionItem,
  projectDashboardListResource,
  projectWidgetListResource,
  widgetDetailResource,
  widgetPreviewRunResource,
  widgetRunResource,
  widgetRunsResource,
  widgetTrendResource,
  widgetVersionsResource,
} from './projection';

export { widgetTrendSource } from './projection';
export type {
  DashboardDetail,
  DashboardListItem,
  DashboardTrendSeries,
  DashboardWidgetDetail,
  DashboardWidgetItem,
  DashboardWidgetRunDetail,
  DashboardWidgetRunItem,
  DashboardWidgetVersionItem,
};

/** Poll a board while one of its widgets is mid-run, so the card settles on its own. */
const RUNNING_POLL_INTERVAL = 3000;
/**
 * Slow baseline poll for boards with a scheduled run pending: a scheduled
 * widget can start after an idle load, when the cached projection still says
 * nothing is running — the baseline observes the transition. The driver only
 * fires it while the tab is visible, so hidden boards cost nothing.
 */
const IDLE_POLL_INTERVAL = 30_000;

const hasRunningWidget = (detail?: DashboardDetail) =>
  !!detail?.items.some(({ widget }) => widget.lastRunStatus === 'running');

const hasScheduledWidget = (detail?: DashboardDetail) =>
  !!detail?.items.some(({ widget }) => widget.nextRunAt != null);

/**
 * What a migrated read hook hands back. Same shape the SWR hooks returned, so
 * call sites keep reading `data` / `error` / `isLoading` / `mutate`; `data` is
 * the replica's store projection, not the fetch response — a persisted entry
 * therefore paints on the first frame instead of after the request.
 */
export interface DashboardRequest<TData> {
  data: TData | undefined;
  error: unknown;
  isLoading: boolean;
  isValidating: boolean;
  mutate: () => Promise<unknown>;
}

const toRequest = <TData>(
  sync: ReplicaSyncResult,
  data: TData | undefined,
): DashboardRequest<TData> => ({
  data,
  error: sync.error,
  isLoading: !sync.isHydrated || (data === undefined && sync.isValidating),
  isValidating: sync.isValidating,
  mutate: sync.revalidate,
});

export interface DashboardAction {
  addWidgetToDashboard: (dashboardId: string, widgetId: string) => Promise<unknown>;
  createDashboard: (params: CreateDashboardParams) => Promise<DashboardListItem>;
  publishWidgetVersion: (
    widgetId: string,
    versionId: string,
  ) => Promise<Awaited<ReturnType<typeof dashboardService.publish>>>;
  refreshDashboardDetail: (dashboardId: string) => Promise<unknown>;
  refreshDashboards: (level?: WidgetLevelFilter) => Promise<unknown>;
  refreshWidget: (widgetId: string) => Promise<unknown>;
  refreshWidgetDetail: (widgetId: string) => Promise<unknown>;
  /** The agent placed a widget server-side: revalidate everything that shows it. */
  refreshWidgetPlacement: (widgetId: string, dashboardId?: string) => Promise<unknown>;
  removeWidgetFromDashboard: (dashboardId: string, itemId: string) => Promise<void>;
  renameDashboard: (dashboardId: string, title: string, level?: WidgetLevelFilter) => Promise<void>;
  runWidget: (widgetId: string) => Promise<DashboardWidgetRunItem | undefined>;
  saveDashboardLayout: (
    dashboardId: string,
    layouts: Record<string, DashboardItemLayout>,
    order: string[],
  ) => Promise<void>;
  trashDashboard: (dashboardId: string, level?: WidgetLevelFilter) => Promise<void>;
  /** Fetch orchestration only; read the board with `dashboardSelectors.dashboardDetail`. */
  useFetchDashboardDetail: (dashboardId?: string) => DashboardRequest<DashboardDetail>;
  useFetchDashboards: (
    level?: WidgetLevelFilter,
    enabled?: boolean,
  ) => DashboardRequest<DashboardListItem[]>;
  useFetchProjectDashboards: (projectId?: string) => DashboardRequest<DashboardListItem[]>;
  useFetchProjectWidgets: (projectId?: string) => DashboardRequest<DashboardWidgetItem[]>;
  useFetchWidgetDetail: (widgetId?: string) => DashboardRequest<DashboardWidgetDetail>;
  useFetchWidgetRun: (
    widgetId?: string,
    runId?: string,
  ) => DashboardRequest<DashboardWidgetRunDetail>;
  useFetchWidgetRuns: (widgetId?: string) => DashboardRequest<DashboardWidgetRunItem[]>;
  useFetchWidgetTrend: (widget?: DashboardWidgetItem) => DashboardRequest<DashboardTrendSeries[]>;
  useFetchWidgetVersionPreviewRun: (
    widgetId?: string,
    versionId?: string,
  ) => DashboardRequest<DashboardWidgetRunDetail | null>;
  useFetchWidgetVersions: (widgetId?: string) => DashboardRequest<DashboardWidgetVersionItem[]>;
}

export type DashboardStore = DashboardState & DashboardAction;

const devtools = createDevtools('dashboard');

export const useDashboardStore = createWithEqualityFn<DashboardStore>()(
  devtools((set, get): DashboardStore => {
    const list = createReplicaSlice(dashboardListResource, {
      actionPrefix: 'dashboard/list',
      entity: arrayEntity<DashboardListItem>((board) => board.id),
      get,
      set,
      stateKey: 'dashboardListReplica',
      view: recordLens<DashboardStore, DashboardListItem[]>('dashboardListByLevel'),
    });
    const projectList = createReplicaSlice(projectDashboardListResource, {
      actionPrefix: 'dashboard/projectList',
      entity: arrayEntity<DashboardListItem>((board) => board.id),
      get,
      set,
      stateKey: 'projectDashboardsReplica',
      view: recordLens<DashboardStore, DashboardListItem[]>('projectDashboardsMap'),
    });
    const projectWidgets = createReplicaSlice(projectWidgetListResource, {
      actionPrefix: 'dashboard/projectWidgets',
      entity: arrayEntity<DashboardWidgetItem>((widget) => widget.id),
      get,
      set,
      stateKey: 'projectWidgetsReplica',
      view: recordLens<DashboardStore, DashboardWidgetItem[]>('projectWidgetsMap'),
    });
    const detail = createReplicaSlice(dashboardDetailResource, {
      actionPrefix: 'dashboard/detail',
      // The detail adds `items` on top of the board row every list also holds.
      entity: singleEntity<DashboardDetail, DashboardListItem>((board) => board.id, {
        get: ({ items: _items, ...board }) => board as DashboardListItem,
        set: (current, board) => ({ ...current, ...board }),
      }),
      get,
      set,
      stateKey: 'dashboardDetailReplica',
      view: recordLens<DashboardStore, DashboardDetail>('dashboardDetailMap'),
    });
    const widgetDetail = createReplicaSlice(widgetDetailResource, {
      actionPrefix: 'dashboard/widgetDetail',
      entity: singleEntity<DashboardWidgetDetail>((widget) => widget.id),
      get,
      set,
      stateKey: 'widgetDetailReplica',
      view: recordLens<DashboardStore, DashboardWidgetDetail>('widgetDetailMap'),
    });
    const versions = createReplicaSlice(widgetVersionsResource, {
      actionPrefix: 'dashboard/versions',
      get,
      set,
      stateKey: 'widgetVersionsReplica',
      view: recordLens<DashboardStore, DashboardWidgetVersionItem[]>('widgetVersionsMap'),
    });
    const runs = createReplicaSlice(widgetRunsResource, {
      actionPrefix: 'dashboard/runs',
      get,
      set,
      stateKey: 'widgetRunsReplica',
      view: recordLens<DashboardStore, DashboardWidgetRunItem[]>('widgetRunsMap'),
    });
    const runDetail = createReplicaSlice(widgetRunResource, {
      actionPrefix: 'dashboard/run',
      get,
      set,
      stateKey: 'widgetRunDetailReplica',
      view: recordLens<DashboardStore, DashboardWidgetRunDetail>('widgetRunDetailMap'),
    });
    const previewRun = createReplicaSlice(widgetPreviewRunResource, {
      actionPrefix: 'dashboard/previewRun',
      get,
      set,
      stateKey: 'widgetPreviewRunReplica',
      view: recordLens<DashboardStore, DashboardWidgetRunDetail | null>('widgetPreviewRunMap'),
    });
    const trend = createReplicaSlice(widgetTrendResource, {
      actionPrefix: 'dashboard/trend',
      get,
      set,
      stateKey: 'widgetTrendReplica',
      view: recordLens<DashboardStore, DashboardTrendSeries[]>('widgetTrendMap'),
    });

    // The same board lives in a level's list, its project's list and its detail
    // page; one edit (rename / trash) lands in every loaded copy at once.
    const board = linkReplicaEntity<DashboardListItem>([list, projectList, detail]);

    const refreshDashboards = async (level?: WidgetLevelFilter) => {
      await Promise.all([
        list.revalidate(dashboardLevelKey(level)),
        level?.projectId ? projectList.revalidate(level.projectId) : undefined,
      ]);
    };

    /**
     * Refresh a widget now, or after the run a refresh started. Every board
     * showing it, its project's widget list, its history and its trend move
     * together, whether the run succeeded or not.
     */
    const refreshWidget = async (widgetId: string) => {
      await Promise.all([
        detail.revalidate(),
        projectWidgets.revalidate(),
        widgetDetail.revalidate(widgetId),
        runs.revalidate(widgetId),
        trend.revalidate(widgetId),
      ]);
    };

    return {
      ...initialState,

      // ── Reads ──

      useFetchDashboards: (level = {}, enabled = true) => {
        const data = useDashboardStore((s) => s.dashboardListByLevel[dashboardLevelKey(level)]);
        return toRequest(list.useSync(level, { enabled }), data);
      },

      useFetchProjectDashboards: (projectId) => {
        const data = useDashboardStore((s) =>
          projectId ? s.projectDashboardsMap[projectId] : undefined,
        );
        return toRequest(projectList.useSync(projectId ?? null), data);
      },

      /** Every widget of a project — placed on a board or not — so none gets lost. */
      useFetchProjectWidgets: (projectId) => {
        const data = useDashboardStore((s) =>
          projectId ? s.projectWidgetsMap[projectId] : undefined,
        );
        const sync = projectWidgets.useSync(projectId ?? null, {
          refreshInterval: data?.some(({ lastRunStatus }) => lastRunStatus === 'running')
            ? RUNNING_POLL_INTERVAL
            : data?.some(({ nextRunAt }) => nextRunAt != null)
              ? IDLE_POLL_INTERVAL
              : 0,
        });
        return toRequest(sync, data);
      },

      useFetchDashboardDetail: (dashboardId) => {
        const data = useDashboardStore((s) =>
          dashboardId ? s.dashboardDetailMap[dashboardId] : undefined,
        );
        const sync = detail.useSync(dashboardId ?? null, {
          refreshInterval: hasRunningWidget(data)
            ? RUNNING_POLL_INTERVAL
            : hasScheduledWidget(data)
              ? IDLE_POLL_INTERVAL
              : 0,
        });
        return toRequest(sync, data);
      },

      useFetchWidgetDetail: (widgetId) => {
        const data = useDashboardStore((s) => (widgetId ? s.widgetDetailMap[widgetId] : undefined));
        const sync = widgetDetail.useSync(widgetId ?? null, {
          refreshInterval: data?.lastRunStatus === 'running' ? RUNNING_POLL_INTERVAL : 0,
        });
        return toRequest(sync, data);
      },

      /** One run with its output and logs; polls until it settles. */
      useFetchWidgetRun: (widgetId, runId) => {
        const data = useDashboardStore((s) => (runId ? s.widgetRunDetailMap[runId] : undefined));
        const sync = runDetail.useSync(widgetId && runId ? { runId, widgetId } : null, {
          refreshInterval: data?.status === 'running' ? RUNNING_POLL_INTERVAL : 0,
        });
        return toRequest(sync, data);
      },

      useFetchWidgetRuns: (widgetId) => {
        const data = useDashboardStore((s) => (widgetId ? s.widgetRunsMap[widgetId] : undefined));
        const sync = runs.useSync(widgetId ?? null, {
          refreshInterval: data?.some(({ status }) => status === 'running')
            ? RUNNING_POLL_INTERVAL
            : 0,
        });
        return toRequest(sync, data);
      },

      useFetchWidgetVersions: (widgetId) => {
        const data = useDashboardStore((s) =>
          widgetId ? s.widgetVersionsMap[widgetId] : undefined,
        );
        return toRequest(versions.useSync(widgetId ?? null), data);
      },

      useFetchWidgetVersionPreviewRun: (widgetId, versionId) => {
        const key = widgetId && versionId ? `${widgetId}:${versionId}` : undefined;
        const data = useDashboardStore((s) => (key ? s.widgetPreviewRunMap[key] : undefined));
        return toRequest(
          previewRun.useSync(widgetId && versionId ? { versionId, widgetId } : null),
          data,
        );
      },

      useFetchWidgetTrend: (widget) => {
        const data = useDashboardStore((s) => (widget ? s.widgetTrendMap[widget.id] : undefined));
        const sync = trend.useSync(widget ?? null);
        return toRequest(sync, data);
      },

      // ── Dashboards ──

      createDashboard: async (params) => {
        set({ dashboardCreating: true }, false, 'dashboard/create/start');
        try {
          const dashboard = await dashboardService.create(params);
          await Promise.all([
            refreshDashboards(params),
            params.widgetId ? widgetDetail.revalidate(params.widgetId) : undefined,
          ]);
          return dashboard;
        } finally {
          set({ dashboardCreating: false }, false, 'dashboard/create/end');
        }
      },

      renameDashboard: async (dashboardId, title, level) => {
        await dashboardService.rename(dashboardId, title);
        // The linked board entity updates the level list, the project list and
        // the detail page in one commit; revalidating picks up server fields.
        board.update(dashboardId, (current) => ({ ...current, title }));
        await Promise.all([detail.revalidate(dashboardId), refreshDashboards(level)]);
      },

      trashDashboard: async (dashboardId, level) => {
        await dashboardService.trash(dashboardId);
        board.remove(dashboardId);
        await refreshDashboards(level);
      },

      /**
       * Persist a board's layout. The new cells render right away; a rejected
       * save revalidates the board so the grid snaps back to what the server holds.
       */
      saveDashboardLayout: async (dashboardId, layouts, order) => {
        const current = get().dashboardDetailMap[dashboardId];
        const sortOrderOf = new Map(order.map((id, index) => [id, index]));
        const patches: DashboardLayoutPatch[] = Object.entries(layouts).map(([id, layout]) => ({
          id,
          layout,
          sortOrder: sortOrderOf.get(id),
        }));

        if (current) {
          detail.update(dashboardId, (value) =>
            value
              ? {
                  ...value,
                  items: value.items
                    .map((entry) => ({
                      ...entry,
                      item: {
                        ...entry.item,
                        layout: layouts[entry.item.id] ?? entry.item.layout,
                        sortOrder: sortOrderOf.get(entry.item.id) ?? entry.item.sortOrder,
                      },
                    }))
                    .sort((a, b) => a.item.sortOrder - b.item.sortOrder),
                }
              : value,
          );
        }

        set(
          (s) => ({ dashboardLayoutSavingIds: [...s.dashboardLayoutSavingIds, dashboardId] }),
          false,
          'dashboard/saveLayout/start',
        );
        try {
          await dashboardService.updateItemLayouts(dashboardId, patches);
        } catch (error) {
          await detail.revalidate(dashboardId);
          throw error;
        } finally {
          set(
            (s) => ({
              dashboardLayoutSavingIds: s.dashboardLayoutSavingIds.filter(
                (id) => id !== dashboardId,
              ),
            }),
            false,
            'dashboard/saveLayout/end',
          );
        }
      },

      removeWidgetFromDashboard: async (dashboardId, itemId) => {
        await dashboardService.removeItems(dashboardId, [itemId]);
        await detail.revalidate(dashboardId);
      },

      // ── Widgets ──

      runWidget: async (widgetId) => {
        set(
          (s) => ({ widgetRunningIds: [...s.widgetRunningIds, widgetId] }),
          false,
          'dashboard/run/start',
        );
        try {
          return await dashboardService.runWidget(widgetId);
        } finally {
          set(
            (s) => ({ widgetRunningIds: s.widgetRunningIds.filter((id) => id !== widgetId) }),
            false,
            'dashboard/run/end',
          );
          await refreshWidget(widgetId);
        }
      },

      /**
       * Make a dry-run-proven version live, then run it once so every board
       * shows live data right away. The server refuses a version whose exact
       * content has not succeeded in a dry run; a failing first run leaves the
       * publish in place.
       */
      publishWidgetVersion: async (widgetId, versionId) => {
        set(
          (s) => ({ widgetPublishingIds: [...s.widgetPublishingIds, widgetId] }),
          false,
          'dashboard/publish/start',
        );
        try {
          const result = await dashboardService.publish(widgetId, versionId);
          await versions.revalidate(widgetId);
          await get()
            .runWidget(widgetId)
            .catch((error) => {
              console.error('[dashboard] first run after publish failed', error);
            });
          return result;
        } finally {
          set(
            (s) => ({ widgetPublishingIds: s.widgetPublishingIds.filter((id) => id !== widgetId) }),
            false,
            'dashboard/publish/end',
          );
        }
      },

      addWidgetToDashboard: async (dashboardId, widgetId) => {
        set(
          (s) => ({ widgetAddingIds: [...s.widgetAddingIds, widgetId] }),
          false,
          'dashboard/add/start',
        );
        try {
          const item = await dashboardService.addItem(dashboardId, widgetId);
          await Promise.all([detail.revalidate(dashboardId), widgetDetail.revalidate(widgetId)]);
          return item;
        } finally {
          set(
            (s) => ({ widgetAddingIds: s.widgetAddingIds.filter((id) => id !== widgetId) }),
            false,
            'dashboard/add/end',
          );
        }
      },

      // ── Refresh ──

      refreshDashboardDetail: async (dashboardId) => {
        await detail.revalidate(dashboardId);
      },

      refreshDashboards,

      refreshWidgetDetail: async (widgetId) => {
        await widgetDetail.revalidate(widgetId);
      },

      refreshWidgetPlacement: async (widgetId, dashboardId) => {
        await Promise.all([
          widgetDetail.revalidate(widgetId),
          dashboardId ? detail.revalidate(dashboardId) : detail.revalidate(),
          list.revalidate(),
          projectList.revalidate(),
          projectWidgets.revalidate(),
        ]);
      },

      refreshWidget,
    };
  }),
  shallow,
);

expose('dashboard', useDashboardStore);
