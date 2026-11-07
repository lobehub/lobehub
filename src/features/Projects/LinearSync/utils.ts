import type {
  LinearIssueCount,
  LinearSyncJobErrorCode,
  LinearSyncJobView,
  LinearSyncResult,
} from '@lobechat/types';
import { isLinearNoProject } from '@lobechat/types';
import { TRPCClientError } from '@trpc/client';
import type { TFunction } from 'i18next';

/** Server message for a revoked or expired Linear token (`LINEAR_RECONNECT_REQUIRED`). */
const RECONNECT_REQUIRED = 'LINEAR_RECONNECT_REQUIRED';

export const linearSyncErrorMessage = (error: unknown, t: TFunction<'integration'>): string =>
  error instanceof TRPCClientError && error.message === RECONNECT_REQUIRED
    ? t('linear.sync.error.reconnect')
    : t('linear.sync.error.generic');

/**
 * How a scope's Linear project reads: its name, "No project", or — for a
 * whole-team scope — `allLabel` when given (a rule omits it, showing the team alone).
 */
export const linearScopeProjectLabel = (
  scope: { linearProjectId: string | null; linearProjectName: string | null },
  t: TFunction<'integration'>,
  options: { withAll?: boolean } = {},
): string | undefined => {
  if (isLinearNoProject(scope.linearProjectId)) return t('linear.sync.filter.noProject');
  if (scope.linearProjectId) return scope.linearProjectName ?? undefined;
  return options.withAll ? t('linear.sync.filter.allProjects') : undefined;
};

/**
 * The scope above the issue list. Including archived issues is chosen a step
 * back, but it decides what the list holds, so it is named here too.
 */
export const linearImportScopeSummary = (
  filter: {
    linearProjectId: string | null;
    linearProjectName: string | null;
    stateTypes: unknown[];
    teamName: string | null;
  },
  options: { includeArchived: boolean },
  t: TFunction<'integration'>,
): string =>
  [
    filter.teamName,
    linearScopeProjectLabel(filter, t, { withAll: true }),
    t('linear.sync.filter.statesSummary', { count: filter.stateTypes.length }),
    options.includeArchived && t('linear.sync.options.includeArchived'),
  ]
    .filter(Boolean)
    .join(' · ');

/**
 * Whether the scope step may move on. "All projects" waits for the team's
 * project list, since without it the choice may be a mistake; "No project"
 * needs only the team, so a failed or slow list does not block it.
 */
export const canLeaveLinearScopeStep = (
  filter: { linearProjectId: string | null; teamId: string | null },
  projects: { error?: unknown; isLoading: boolean },
): boolean =>
  !!filter.teamId &&
  (isLinearNoProject(filter.linearProjectId) || (!projects.isLoading && !projects.error));

/** All skipped issues; the stored list stops at its cap, and older results lack the count. */
export const linearSyncSkippedCount = (result: LinearSyncResult): number =>
  result.skippedCount ?? result.skipped?.length ?? 0;

/** One-line outcome of a sync, e.g. "2 created · 1 updated · 1 closed". */
export const formatLinearSyncResult = (
  result: LinearSyncResult,
  t: TFunction<'integration'>,
): string => {
  const skipped = linearSyncSkippedCount(result);
  const parts = [
    result.created && t('linear.sync.result.created', { count: result.created }),
    result.updated && t('linear.sync.result.updated', { count: result.updated }),
    result.closed && t('linear.sync.result.closed', { count: result.closed }),
    result.commentsImported &&
      t('linear.sync.result.commentsImported', { count: result.commentsImported }),
    result.keptLocalEdits &&
      t('linear.sync.result.keptLocalEdits', { count: result.keptLocalEdits }),
    skipped && t('linear.sync.result.skipped', { count: skipped }),
  ].filter(Boolean) as string[];
  if (parts.length === 0) parts.push(t('linear.sync.result.upToDate'));
  if (result.truncated) parts.push(t('linear.sync.result.truncated'));
  return parts.join(' · ');
};

/**
 * Header counts of the issue picker. The list loads one page at a time, so the
 * loaded count is the total only once every page is in; until then the total
 * comes from the separate count, or reads as "at least" what is loaded.
 */
export const linearIssueListCounts = (
  { hasMore, loaded, total }: { hasMore: boolean; loaded: number; total?: LinearIssueCount },
  t: TFunction<'integration'>,
): { loaded?: string; total: string } => {
  if (!hasMore) return { total: t('linear.sync.list.count', { count: loaded }) };

  // The count can lag behind pages loaded later, or stop at its limit below them.
  const count = Math.max(total?.count ?? 0, loaded);
  const exact = !!total && !total.capped && total.count > loaded;
  return {
    loaded: t('linear.sync.list.loaded', { count: loaded }),
    total: exact
      ? t('linear.sync.list.count', { count })
      : t('linear.sync.list.countAtLeast', { count }),
  };
};

export const isActiveLinearSyncJob = (job: Pick<LinearSyncJobView, 'status'>) =>
  job.status === 'pending' || job.status === 'processing';

/**
 * Progress of a running sync. A rule run that goes on by itself carries the
 * total of its finished rounds, so the count grows while it runs.
 */
export const linearSyncJobProgress = (
  job: Pick<LinearSyncJobView, 'result'>,
  t: TFunction<'integration'>,
): string =>
  job.result?.created
    ? t('linear.sync.job.inProgressCreated', { count: job.result.created })
    : t('linear.sync.job.inProgress');

/** Why a background sync did not finish, for the user. */
export const linearSyncJobErrorMessage = (
  code: LinearSyncJobErrorCode | null,
  t: TFunction<'integration'>,
): string => {
  switch (code) {
    case 'reconnect': {
      return t('linear.sync.error.reconnect');
    }
    case 'unavailable': {
      return t('linear.sync.job.error.unavailable');
    }
    case 'timeout': {
      return t('linear.sync.job.error.timeout');
    }
    case 'canceled': {
      return t('linear.sync.job.error.canceled');
    }
    default: {
      return t('linear.sync.error.generic');
    }
  }
};
