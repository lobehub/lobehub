import type { LinearSyncResult } from '@lobechat/types';
import { LINEAR_NO_PROJECT_ID } from '@lobechat/types';
import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import {
  canLeaveLinearScopeStep,
  formatLinearSyncResult,
  isActiveLinearSyncJob,
  linearImportScopeSummary,
  linearIssueListCounts,
  linearScopeProjectLabel,
  linearSyncJobErrorMessage,
  linearSyncJobProgress,
} from './utils';

const t = ((key: string, options?: { count?: number }) =>
  options?.count === undefined
    ? key
    : `${key}:${options.count}`) as unknown as TFunction<'integration'>;

const result = (overrides: Partial<LinearSyncResult>): LinearSyncResult => ({
  closed: 0,
  created: 0,
  keptLocalEdits: 0,
  skipped: [],
  truncated: false,
  unchanged: 0,
  updated: 0,
  ...overrides,
});

describe('formatLinearSyncResult', () => {
  it('says how many tasks were archived, so a created task missing from the list is explained', () => {
    expect(formatLinearSyncResult(result({ archived: 1, created: 2 }), t)).toBe(
      'linear.sync.result.created:2 · linear.sync.result.archived:1',
    );
  });

  it('lists only what changed, and says when more remain', () => {
    expect(
      formatLinearSyncResult(
        result({
          closed: 1,
          created: 2,
          skipped: [{ identifier: 'ENG-1', reason: 'running' }],
          truncated: true,
        }),
        t,
      ),
    ).toBe(
      'linear.sync.result.created:2 · linear.sync.result.closed:1 · linear.sync.result.skipped:1 · linear.sync.result.truncated',
    );
  });

  it('counts comments copied from Linear', () => {
    expect(formatLinearSyncResult(result({ commentsImported: 3, updated: 1 }), t)).toBe(
      'linear.sync.result.updated:1 · linear.sync.result.commentsImported:3',
    );
    expect(formatLinearSyncResult(result({ commentsImported: 2 }), t)).toBe(
      'linear.sync.result.commentsImported:2',
    );
  });

  it('counts skipped issues past the stored list', () => {
    expect(
      formatLinearSyncResult(
        result({ skipped: [{ identifier: 'ENG-1', reason: 'failed' }], skippedCount: 150 }),
        t,
      ),
    ).toBe('linear.sync.result.skipped:150');
  });

  it('says up to date when nothing changed', () => {
    expect(formatLinearSyncResult(result({ unchanged: 3 }), t)).toBe('linear.sync.result.upToDate');
  });
});

describe('background sync jobs', () => {
  it('treats queued and running jobs as active', () => {
    expect(isActiveLinearSyncJob({ status: 'pending' })).toBe(true);
    expect(isActiveLinearSyncJob({ status: 'processing' })).toBe(true);
    expect(isActiveLinearSyncJob({ status: 'success' })).toBe(false);
    expect(isActiveLinearSyncJob({ status: 'error' })).toBe(false);
  });

  it('explains each way a job can fail', () => {
    expect(linearSyncJobErrorMessage('reconnect', t)).toBe('linear.sync.error.reconnect');
    expect(linearSyncJobErrorMessage('unavailable', t)).toBe('linear.sync.job.error.unavailable');
    expect(linearSyncJobErrorMessage('timeout', t)).toBe('linear.sync.job.error.timeout');
    expect(linearSyncJobErrorMessage('failed', t)).toBe('linear.sync.error.generic');
    expect(linearSyncJobErrorMessage(null, t)).toBe('linear.sync.error.generic');
  });
});

describe('linearSyncJobProgress', () => {
  it('shows how many a run that keeps going has created so far', () => {
    expect(linearSyncJobProgress({ result: null }, t)).toBe('linear.sync.job.inProgress');
    expect(linearSyncJobProgress({ result: result({ created: 0, truncated: true }) }, t)).toBe(
      'linear.sync.job.inProgress',
    );
    expect(linearSyncJobProgress({ result: result({ created: 200, truncated: true }) }, t)).toBe(
      'linear.sync.job.inProgressCreated:200',
    );
  });
});

describe('linearIssueListCounts', () => {
  it('reads the loaded count as the total once every page is in', () => {
    expect(linearIssueListCounts({ hasMore: false, loaded: 12 }, t)).toEqual({
      total: 'linear.sync.list.count:12',
    });
  });

  it('shows the counted total and how many are loaded while pages remain', () => {
    expect(
      linearIssueListCounts({ hasMore: true, loaded: 50, total: { capped: false, count: 234 } }, t),
    ).toEqual({ loaded: 'linear.sync.list.loaded:50', total: 'linear.sync.list.count:234' });
  });

  it('reads as "at least" while the total is being counted, so the first page does not look like all', () => {
    expect(linearIssueListCounts({ hasMore: true, loaded: 50 }, t)).toEqual({
      loaded: 'linear.sync.list.loaded:50',
      total: 'linear.sync.list.countAtLeast:50',
    });
  });

  it('reads as "at least" when the count stopped at its limit or fell behind the loaded pages', () => {
    expect(
      linearIssueListCounts({ hasMore: true, loaded: 50, total: { capped: true, count: 1000 } }, t)
        .total,
    ).toBe('linear.sync.list.countAtLeast:1000');
    expect(
      linearIssueListCounts(
        { hasMore: true, loaded: 1050, total: { capped: true, count: 1000 } },
        t,
      ).total,
    ).toBe('linear.sync.list.countAtLeast:1050');
    expect(
      linearIssueListCounts({ hasMore: true, loaded: 100, total: { capped: false, count: 100 } }, t)
        .total,
    ).toBe('linear.sync.list.countAtLeast:100');
  });
});

describe('linearImportScopeSummary', () => {
  const filter = {
    linearProjectId: null,
    linearProjectName: null,
    stateTypes: ['backlog', 'unstarted'],
    teamName: 'Engineering',
  };

  it('names archived issues only when they are included', () => {
    expect(linearImportScopeSummary(filter, { includeArchived: false }, t)).toBe(
      'Engineering · linear.sync.filter.allProjects · linear.sync.filter.statesSummary:2',
    );
    expect(linearImportScopeSummary(filter, { includeArchived: true }, t)).toBe(
      'Engineering · linear.sync.filter.allProjects · linear.sync.filter.statesSummary:2 · linear.sync.options.includeArchived',
    );
  });
});

describe('linearScopeProjectLabel', () => {
  it('names the project, says No project, or falls back to All projects only when asked', () => {
    const scope = (linearProjectId: string | null, linearProjectName: string | null = null) => ({
      linearProjectId,
      linearProjectName,
    });

    expect(linearScopeProjectLabel(scope('p-1', 'Mobile'), t)).toBe('Mobile');
    expect(linearScopeProjectLabel(scope(LINEAR_NO_PROJECT_ID), t)).toBe(
      'linear.sync.filter.noProject',
    );
    expect(linearScopeProjectLabel(scope(null), t)).toBeUndefined();
    expect(linearScopeProjectLabel(scope(null), t, { withAll: true })).toBe(
      'linear.sync.filter.allProjects',
    );
  });
});

describe('canLeaveLinearScopeStep', () => {
  const loaded = { isLoading: false };
  const failed = { error: new Error('projects failed'), isLoading: false };

  it('needs a team', () => {
    expect(canLeaveLinearScopeStep({ linearProjectId: null, teamId: null }, loaded)).toBe(false);
  });

  it('holds All projects until the project list loads without error', () => {
    const all = { linearProjectId: null, teamId: 'team-1' };
    expect(canLeaveLinearScopeStep(all, loaded)).toBe(true);
    expect(canLeaveLinearScopeStep(all, { isLoading: true })).toBe(false);
    expect(canLeaveLinearScopeStep(all, failed)).toBe(false);
  });

  it('lets No project through when the project list is loading or failed', () => {
    const none = { linearProjectId: LINEAR_NO_PROJECT_ID, teamId: 'team-1' };
    expect(canLeaveLinearScopeStep(none, { isLoading: true })).toBe(true);
    expect(canLeaveLinearScopeStep(none, failed)).toBe(true);
  });
});
