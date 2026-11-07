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

/**
 * States the import dialog starts with: open issues plus completed ones, so a
 * team moving over keeps its history. Canceled issues stay out by default.
 */
export const LINEAR_DEFAULT_IMPORT_STATE_TYPES: LinearIssueStateType[] = [
  ...LINEAR_OPEN_ISSUE_STATE_TYPES,
  'completed',
];

/**
 * `linearProjectId` value that scopes a filter or rule to the team's issues
 * that belong to no Linear project. Linear project ids are UUIDs, so it never
 * names a real project.
 */
export const LINEAR_NO_PROJECT_ID = 'none';

export const isLinearNoProject = (linearProjectId: string | null | undefined): boolean =>
  linearProjectId === LINEAR_NO_PROJECT_ID;

/** Providers a task can be linked to through `task_external_links`. */
export type TaskExternalProvider = 'linear';

/** Facts about the linked Linear issue kept on the link row, for display only. */
export interface LinearIssueLinkMetadata {
  assigneeName?: string;
  /**
   * The issue's comments were read and copied at least once. A closed task
   * whose issue left a rule's filter is caught up only until this is set.
   * Sync bookkeeping, not display: a display refresh keeps it.
   */
  commentsSynced?: boolean;
  labels?: string[];
  projectName?: string;
  stateName?: string;
  stateType?: LinearIssueStateType;
  /**
   * Linear comments already copied onto the task, so syncing again adds only
   * new ones. Sync bookkeeping, not display: a display refresh keeps it.
   */
  syncedCommentIds?: string[];
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

/** How many issues match a picker filter; counting stops at a limit. */
export interface LinearIssueCount {
  /** True when more issues match than were counted; `count` is then a lower bound. */
  capped: boolean;
  count: number;
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
  /** The task was synced, but its Linear comments were not; the next sync retries them. */
  | 'commentsFailed'
  /** Picked for import, but Linear no longer returns it (deleted, or not visible). */
  | 'missing';

export interface LinearSyncResult {
  /** Tasks closed because their issue was completed or canceled in Linear. */
  closed: number;
  /** Linear comments copied onto tasks as task comments. Absent in older results. */
  commentsImported?: number;
  created: number;
  /** Tasks edited in LobeHub, so their name, instruction and priority were kept. */
  keptLocalEdits: number;
  /** The first skipped issues with why; `skippedCount` holds the full count. */
  skipped: { identifier: string; reason: LinearSyncSkipReason }[];
  /** Every skipped issue, including those past the `skipped` list. Absent in older results. */
  skippedCount?: number;
  /**
   * More issues matched than one run imports. A rule run continues on its own
   * until this clears; it stays set only when the run stopped early.
   */
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
  /** The user stopped it; tasks written before then are kept. */
  | 'canceled'
  | 'failed';

/** What a background sync was asked to do, kept on its `async_tasks` row. */
export interface LinearSyncJobMetadata {
  connectionId: string;
  /**
   * Where the next round of a rule run resumes reading Linear, so a long run
   * does not reread what earlier rounds covered. Absent: read from the start.
   */
  cursor?: string;
  /**
   * Times a rule run was handed to a new request because one ran out of time.
   * Each hand-off is one more request in a chain the host cuts off a few
   * requests deep, so a run stops handing off after a few.
   */
  handOffs?: number;
  /**
   * A rule run also reads archived issues (`kind: 'rule'`). Picked issues are
   * looked up by id, which finds archived ones either way.
   */
  includeArchived?: boolean;
  /** Picked issues (`kind: 'issues'`). */
  issueIds?: string[];
  kind: 'issues' | 'rule';
  projectId: string;
  /**
   * This round reconciles linked tasks but creates none: the closing pass of
   * a run that used up its creating rounds.
   */
  reconcileOnly?: boolean;
  /** The outcome so far; while a rule run continues, the total of its finished rounds. */
  result?: LinearSyncResult;
  /** Rounds a rule run has finished; each creates at most a fixed number of tasks. */
  rounds?: number;
  /** The saved rule being run (`kind: 'rule'`). */
  ruleId?: string;
  /** Copy each issue's Linear comments onto its task as task comments. */
  syncComments?: boolean;
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
