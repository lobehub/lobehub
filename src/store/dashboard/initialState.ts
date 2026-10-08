import type { WidgetLevelFilter } from '@lobechat/types';

import { createReplicaState, type ReplicaState } from '@/libs/replica';
import type {
  DashboardDetail,
  DashboardListItem,
  DashboardTrendSeries,
  DashboardWidgetDetail,
  DashboardWidgetItem,
  DashboardWidgetRunDetail,
  DashboardWidgetRunItem,
  DashboardWidgetVersionItem,
} from '@/services/dashboard';

export interface DashboardState {
  /** A create request is in flight (no persistent id to key it by yet). */
  dashboardCreating: boolean;
  /** Boards with their placed widgets, keyed by dashboard id. */
  dashboardDetailMap: Record<string, DashboardDetail>;
  /** Replica bookkeeping for `dashboardDetailMap`. */
  dashboardDetailReplica: ReplicaState<DashboardDetail>;
  /** Boards whose layout save is in flight. */
  dashboardLayoutSavingIds: string[];
  /** Board lists keyed by `dashboardLevelKey` — each level lists only what lives directly on it. */
  dashboardListByLevel: Record<string, DashboardListItem[]>;
  /** Replica bookkeeping for `dashboardListByLevel`. */
  dashboardListReplica: ReplicaState<DashboardListItem[]>;
  /** Every board of a project (with or without an agent), keyed by project id. */
  projectDashboardsMap: Record<string, DashboardListItem[]>;
  /** Replica bookkeeping for `projectDashboardsMap`. */
  projectDashboardsReplica: ReplicaState<DashboardListItem[]>;
  /** Every widget of a project (with or without an agent), keyed by project id. */
  projectWidgetsMap: Record<string, DashboardWidgetItem[]>;
  /** Replica bookkeeping for `projectWidgetsMap`. */
  projectWidgetsReplica: ReplicaState<DashboardWidgetItem[]>;
  /** Widgets with a board placement request in flight. */
  widgetAddingIds: string[];
  /** Widgets opened on their own (outside a board), keyed by widget id. */
  widgetDetailMap: Record<string, DashboardWidgetDetail>;
  /** Replica bookkeeping for `widgetDetailMap`. */
  widgetDetailReplica: ReplicaState<DashboardWidgetDetail>;
  /**
   * The preview run behind a publish approval, keyed `<widgetId>:<versionId>`
   * — fetched by version (not window-limited), and `null` when the version has
   * no usable preview run.
   */
  widgetPreviewRunMap: Record<string, DashboardWidgetRunDetail | null>;
  /** Replica bookkeeping for `widgetPreviewRunMap`. */
  widgetPreviewRunReplica: ReplicaState<DashboardWidgetRunDetail | null>;
  /** Widgets with a publish request in flight. */
  widgetPublishingIds: string[];
  /** Single runs with output and logs, keyed by run id. */
  widgetRunDetailMap: Record<string, DashboardWidgetRunDetail>;
  /** Replica bookkeeping for `widgetRunDetailMap`. */
  widgetRunDetailReplica: ReplicaState<DashboardWidgetRunDetail>;
  /** Widgets with a manual refresh in flight from this client. */
  widgetRunningIds: string[];
  /** Recent run history, newest first, keyed by widget id. */
  widgetRunsMap: Record<string, DashboardWidgetRunItem[]>;
  /** Replica bookkeeping for `widgetRunsMap`. */
  widgetRunsReplica: ReplicaState<DashboardWidgetRunItem[]>;
  /** Long-term metric trend, keyed by widget id. */
  widgetTrendMap: Record<string, DashboardTrendSeries[]>;
  /** Replica bookkeeping for `widgetTrendMap`. */
  widgetTrendReplica: ReplicaState<DashboardTrendSeries[]>;
  /** Version history, newest first, keyed by widget id. */
  widgetVersionsMap: Record<string, DashboardWidgetVersionItem[]>;
  /** Replica bookkeeping for `widgetVersionsMap`. */
  widgetVersionsReplica: ReplicaState<DashboardWidgetVersionItem[]>;
}

export const initialState: DashboardState = {
  dashboardCreating: false,
  dashboardDetailMap: {},
  dashboardDetailReplica: createReplicaState(),
  dashboardLayoutSavingIds: [],
  dashboardListByLevel: {},
  dashboardListReplica: createReplicaState(),
  projectDashboardsMap: {},
  projectDashboardsReplica: createReplicaState(),
  projectWidgetsMap: {},
  projectWidgetsReplica: createReplicaState(),
  widgetAddingIds: [],
  widgetDetailMap: {},
  widgetDetailReplica: createReplicaState(),
  widgetPublishingIds: [],
  widgetPreviewRunMap: {},
  widgetPreviewRunReplica: createReplicaState(),
  widgetRunDetailMap: {},
  widgetRunDetailReplica: createReplicaState(),
  widgetRunningIds: [],
  widgetRunsMap: {},
  widgetRunsReplica: createReplicaState(),
  widgetTrendMap: {},
  widgetTrendReplica: createReplicaState(),
  widgetVersionsMap: {},
  widgetVersionsReplica: createReplicaState(),
};

/** Personal (or current-workspace) level when neither id is set. */
export const dashboardLevelKey = ({ agentId, projectId }: WidgetLevelFilter = {}) =>
  [projectId && `project:${projectId}`, agentId && `agent:${agentId}`].filter(Boolean).join('/') ||
  'personal';
