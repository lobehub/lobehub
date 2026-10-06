import type {
  WidgetManifest,
  WidgetOutput,
  WidgetOutputType,
  WidgetRunError,
  WidgetRunStatus,
  WidgetRuntime,
  WidgetRunTrigger,
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
  runtime: WidgetRuntime;
  script: string;
  view?: WidgetView | null;
}

export interface WidgetVersionRecord extends WidgetVersionContent {
  changeNote?: string | null;
  id: string;
  status: 'draft' | 'published' | 'archived';
  version: number;
}

export interface DashboardWidgetRecord {
  description?: string | null;
  draftVersion?: WidgetVersionRecord | null;
  id: string;
  publishedVersion?: WidgetVersionRecord | null;
  schedulePattern?: string | null;
  scheduleTimezone?: string | null;
  title: string;
}

export interface WidgetRunRecord {
  durationMs?: number | null;
  error?: WidgetRunError | null;
  exitCode?: number | null;
  finishedAt?: Date | string | null;
  id: string;
  output?: WidgetOutput | null;
  startedAt?: Date | string | null;
  status: WidgetRunStatus;
  stderr?: string | null;
  stdout?: string | null;
  trigger: WidgetRunTrigger;
  versionId: string;
}

export interface DashboardSummary {
  id: string;
  /** Set for a board of the conversation's project; home boards have none. */
  projectId?: string | null;
  title: string;
  widgets: { id: string; title: string }[];
}

export interface DashboardWidgetSummary {
  /** The current draft's version id, so the model can pin dry runs and publishes to it. */
  draftVersionId?: string | null;
  hasDraft: boolean;
  id: string;
  lastRunStatus?: WidgetRunStatus | null;
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
  /**
   * The exact version to run — and, for a credentialed / networked draft, the
   * one the user approves. Never resolved from "the current draft".
   */
  versionId: string;
  widgetId: string;
}

export interface DryRunWidgetState {
  durationMs?: number | null;
  error?: WidgetRunError | null;
  runId: string;
  status: WidgetRunStatus;
  versionId: string;
  widgetId: string;
}

// ==================== requestPublish ====================

export interface RequestPublishParams {
  /** One line on what changes for the user, shown on the confirmation card. */
  summary?: string;
  /**
   * The exact version the user approves and that goes live. Never resolved
   * from "the current draft" at execution time: another tab could have saved
   * a newer draft while the approval was pending.
   */
  versionId: string;
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
  /** The board's project, so the card links to the project's dashboard page. */
  projectId?: string | null;
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
    status: WidgetRunStatus;
    trigger: WidgetRunTrigger;
  }[];
  widgetId: string;
}
