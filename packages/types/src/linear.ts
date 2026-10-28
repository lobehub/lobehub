/**
 * Linear integration domain: a LobeHub user's OAuth connection to a Linear
 * organization.
 */

/** `{ accessToken, refreshToken? }` as stored encrypted in `linear_connections.credentials`. */
export interface LinearConnectionCredentials {
  accessToken: string;
  refreshToken?: string;
}

/** Display facts about the organization and the person who connected it. */
export interface LinearConnectionMetadata {
  /** Avatar of the Linear user who authorized the connection. */
  actorAvatarUrl?: string;
  organizationLogoUrl?: string;
  /** OAuth scopes Linear granted. */
  scopes?: string[];
}

/** Connection as the client sees it: never carries credentials. */
export interface LinearConnectionView {
  actorExternalId: string;
  actorName: string;
  createdAt: Date;
  id: string;
  metadata: LinearConnectionMetadata;
  organizationId: string;
  organizationName: string;
  organizationUrlKey: string;
  userId: string;
  workspaceId: string | null;
}

// ── Issue sync (Linear → LobeHub Task, one way) ──────────

/** Linear's workflow state categories; every team's custom states map onto one. */
export const LINEAR_ISSUE_STATE_TYPES = [
  'triage',
  'backlog',
  'unstarted',
  'started',
  'completed',
  'canceled',
] as const;
export type LinearIssueStateType = (typeof LINEAR_ISSUE_STATE_TYPES)[number];

/** States synced by default: everything still open. */
export const LINEAR_OPEN_ISSUE_STATE_TYPES: LinearIssueStateType[] = [
  'triage',
  'backlog',
  'unstarted',
  'started',
];

/** Providers a task can be linked to through `task_external_links`. */
export type TaskExternalProvider = 'linear';

/** Facts about the linked Linear issue kept on the link row, for display only. */
export interface LinearIssueLinkMetadata {
  assigneeName?: string;
  labels?: string[];
  projectName?: string;
  stateName?: string;
  stateType?: LinearIssueStateType;
  teamKey?: string;
}

export interface LinearTeamSummary {
  id: string;
  key: string;
  name: string;
}

export interface LinearProjectSummary {
  id: string;
  name: string;
}

/** An issue as the import picker lists it. */
export interface LinearIssueSummary {
  assigneeName?: string;
  id: string;
  identifier: string;
  /** Already linked to a task in the caller's scope. */
  linkedTaskIdentifier?: string;
  priority: number;
  projectName?: string;
  stateName: string;
  stateType: LinearIssueStateType;
  title: string;
  updatedAt: string;
  url: string;
}

export interface LinearIssuePage {
  cursor?: string;
  hasMore: boolean;
  issues: LinearIssueSummary[];
}

/** Why an issue was left alone. */
export type LinearSyncSkipReason =
  /** Linear closed it, but the task is running; it is not interrupted. */
  | 'running'
  /** The linked task is in the trash or no longer visible to the caller. */
  | 'unavailable'
  /** Closed in Linear and never imported, so there is nothing to close. */
  | 'closed'
  /** Writing the task failed; the next sync retries it. */
  | 'failed'
  /** Picked for import, but Linear no longer returns it (deleted, or not visible). */
  | 'missing';

export interface LinearSyncResult {
  /** Tasks closed because their issue was completed or canceled in Linear. */
  closed: number;
  created: number;
  /** Tasks edited in LobeHub, so their name, instruction and priority were kept. */
  keptLocalEdits: number;
  /** The first skipped issues with why; `skippedCount` holds the full count. */
  skipped: { identifier: string; reason: LinearSyncSkipReason }[];
  /** Every skipped issue, including those past the `skipped` list. Absent in older results. */
  skippedCount?: number;
  /** More issues matched than one run imports; run again for the rest. */
  truncated: boolean;
  unchanged: number;
  updated: number;
}

export interface LinearSyncRuleView {
  connectionId: string;
  createdAt: Date;
  id: string;
  lastResult: LinearSyncResult | null;
  lastRunAt: Date | null;
  linearProjectId: string | null;
  linearProjectName: string | null;
  /** LobeHub project the rule syncs into. */
  projectId: string;
  stateTypes: LinearIssueStateType[];
  teamId: string;
  teamName: string;
}

/** Why a background sync stopped without a result. */
export type LinearSyncJobErrorCode =
  /** The Linear token was revoked or expired; reconnect the workspace. */
  | 'reconnect'
  /** The project, rule or connection is gone or no longer visible. */
  | 'unavailable'
  /** No progress for too long; the run was likely cut off. */
  | 'timeout'
  | 'failed';

/** What a background sync was asked to do, kept on its `async_tasks` row. */
export interface LinearSyncJobMetadata {
  connectionId: string;
  /** Picked issues (`kind: 'issues'`). */
  issueIds?: string[];
  kind: 'issues' | 'rule';
  projectId: string;
  result?: LinearSyncResult;
  /** The saved rule being run (`kind: 'rule'`). */
  ruleId?: string;
}

export interface LinearSyncJobView {
  createdAt: Date;
  error: LinearSyncJobErrorCode | null;
  id: string;
  /** Number of picked issues; absent for a rule run. */
  issueCount?: number;
  kind: 'issues' | 'rule';
  projectId: string;
  result: LinearSyncResult | null;
  ruleId: string | null;
  status: 'pending' | 'processing' | 'success' | 'error';
  updatedAt: Date;
}
