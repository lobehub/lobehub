import type {
  DashboardWidgetRunError,
  DashboardWidgetRunStatus,
  DashboardWidgetRuntime,
  DashboardWidgetRunTrigger,
  WidgetManifest,
  WidgetOutput,
  WidgetOutputType,
  WidgetView,
} from '@lobechat/types';

export const DashboardIdentifier = 'lobe-dashboard';

export const DashboardApiName = {
  listDashboards: 'listDashboards',

  createWidgetDraft: 'createWidgetDraft',
  updateWidgetDraft: 'updateWidgetDraft',
  dryRunWidget: 'dryRunWidget',
  requestPublish: 'requestPublish',
  addWidgetToDashboard: 'addWidgetToDashboard',
  getWidgetRuns: 'getWidgetRuns',
} as const;

export type DashboardApiNameType = (typeof DashboardApiName)[keyof typeof DashboardApiName];

// ==================== Shared records ====================

/** The script + contract of one version, as the model authors it. */
export interface WidgetVersionContent {
  manifest?: WidgetManifest | null;
  outputType: WidgetOutputType;
  runtime: DashboardWidgetRuntime;
  script: string;
  view?: WidgetView | null;
}

export interface DashboardWidgetVersionRecord extends WidgetVersionContent {
  changeNote?: string | null;
  id: string;
  status: 'draft' | 'published' | 'archived';
  version: number;
}

export interface DashboardWidgetRecord {
  description?: string | null;
  draftVersion?: DashboardWidgetVersionRecord | null;
  id: string;
  publishedVersion?: DashboardWidgetVersionRecord | null;
  schedulePattern?: string | null;
  scheduleTimezone?: string | null;
  title: string;
}

export interface DashboardWidgetRunRecord {
  durationMs?: number | null;
  error?: DashboardWidgetRunError | null;
  exitCode?: number | null;
  finishedAt?: Date | string | null;
  id: string;
  output?: WidgetOutput | null;
  startedAt?: Date | string | null;
  status: DashboardWidgetRunStatus;
  stderr?: string | null;
  stdout?: string | null;
  trigger: DashboardWidgetRunTrigger;
  versionId: string;
}

export interface DashboardSummary {
  id: string;
  title: string;
  widgets: { id: string; title: string }[];
}

export interface DashboardWidgetSummary {
  hasDraft: boolean;
  id: string;
  lastRunStatus?: DashboardWidgetRunStatus | null;
  published: boolean;
  title: string;
}

// ==================== listDashboards ====================

export type ListDashboardsParams = Record<string, never>;

export interface ListDashboardsState {
  dashboards: DashboardSummary[];
  widgets: DashboardWidgetSummary[];
}

// ==================== createWidgetDraft ====================

export interface CreateWidgetDraftParams extends WidgetVersionContent {
  /** Metric definition (口径): source, filters, window, unit. */
  description: string;
  title: string;
}

export interface WidgetDraftState {
  version: number;
  versionId: string;
  widgetId: string;
}

// ==================== updateWidgetDraft ====================

export interface UpdateWidgetDraftParams extends Partial<WidgetVersionContent> {
  changeNote?: string;
  description?: string;
  title?: string;
  widgetId: string;
}

// ==================== dryRunWidget ====================

export interface DryRunWidgetParams {
  /** Defaults to the widget's current draft. */
  versionId?: string;
  widgetId: string;
}

export interface DryRunWidgetState {
  durationMs?: number | null;
  error?: DashboardWidgetRunError | null;
  runId: string;
  status: DashboardWidgetRunStatus;
  versionId: string;
  widgetId: string;
}

// ==================== requestPublish ====================

export interface RequestPublishParams {
  /** One line on what changes for the user, shown on the confirmation card. */
  summary?: string;
  /** Defaults to the widget's current draft. */
  versionId?: string;
  widgetId: string;
}

export interface RequestPublishState {
  schedulePattern?: string | null;
  version: number;
  versionId: string;
  widgetId: string;
}

// ==================== addWidgetToDashboard ====================

export interface AddWidgetToDashboardParams {
  /** An existing dashboard from listDashboards. */
  dashboardId?: string;
  /** Create a new dashboard with this name instead. */
  newDashboardTitle?: string;
  widgetId: string;
}

export interface AddWidgetToDashboardState {
  createdDashboard: boolean;
  dashboardId: string;
  dashboardTitle: string;
  widgetId: string;
}

// ==================== getWidgetRuns ====================

export interface GetWidgetRunsParams {
  limit?: number;
  /** Return this run's full logs instead of the recent list. */
  runId?: string;
  widgetId: string;
}

export interface GetWidgetRunsState {
  runs: {
    durationMs?: number | null;
    errorCode?: string | null;
    id: string;
    startedAt?: Date | string | null;
    status: DashboardWidgetRunStatus;
    trigger: DashboardWidgetRunTrigger;
  }[];
  widgetId: string;
}
